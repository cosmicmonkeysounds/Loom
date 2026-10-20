// Wave 13 (booth lane): a scan opens the guest's card at once — facts first
// (Not cleared, ⛔, 🔒, 📍, the story's flags), at most three story buttons
// on its face (the live objectives' buttons the server says are live for
// this guest, then the ones live because of this guest), the story's reply
// to the press on the card, and every other button under "All buttons… (n)"
// with its description.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FACE_MAX, FACE_SETTLE_MS, FOLD_AUTO_MAX, boothHost, cardButtons, cardGuestFacts, cardReadKey, faceSettled, factChips, foldOpensItself, inFlightGate, pressOutcome, scanRepeated } from "../src/booth/model.ts";
import { ApiError } from "../src/client.ts";
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
    expect(chips.map((c) => c.text)).toEqual(["🔒 Captured", "Marked", "✗ Not checked in", "⛔ Restricted", "📍 The Internet", "Room: Tent"]);
  });
  it("by severity (fix round): Marked / In the Internet loud, Late / Bathroom Mode warn, Cleared quiet", () => {
    const f = (label: string) => ({ label, path: `p.${label}`, value: "true", on: true });
    const chips = factChips(g({ flags: [f("Cleared"), f("Late"), f("Marked"), f("Bathroom Mode"), f("In the Internet"), f("Checked in")] }), "The Desktop");
    expect(chips).toEqual([
      { text: "Marked", tone: "loud" },
      { text: "In the Internet", tone: "loud" },
      { text: "Late", tone: "warn" },
      { text: "Bathroom Mode", tone: "warn" },
      { text: "📍 The Desktop", tone: "quiet" },
      { text: "✓ Cleared", tone: "quiet" },
      { text: "✓ Checked in", tone: "quiet" },
    ]);
  });
  it("marks the objective's own face button as the default; a button live only because of the guest is not", () => {
    const out = cardButtons(list, [obj("a", ["send"])], card(["send", "crew", "reinstalled"], ["reinstalled"]), NORTON, false);
    expect(out.face.map((b) => [b.interaction.id, b.named === true])).toEqual([["send", true], ["reinstalled", false]]);
    const html = renderToStaticMarkup(<GuestCardBody session={fakeSession({ objectives: [obj("a", ["send"])] })} guestId="g-1" seed={{ card: card(["send", "crew", "reinstalled"], ["reinstalled"]) }} admin={false} onOpenThread={() => {}} />);
    expect(html.match(/booth-default/g)?.length).toBe(1);
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

  it("with an objective whose buttons are not live here, says the rest are below and opens the fold", () => {
    // The objective names Send, which is not live for Ada; Put on the watchlist is.
    const html = renderToStaticMarkup(
      <GuestCardBody session={fakeSession({ objectives: [obj("door", ["send"])] })} guestId="g-1" seed={{ card: card(["watch"]) }} admin={false} onOpenThread={() => {}} />,
    );
    expect(html).not.toContain("Nothing for Norton Anti-Virus to press");
    expect(html).toContain("Nothing your objective needs on Ada right now — the other buttons are below.");
    expect(html).toMatch(/aria-expanded="true"[^>]*>▾ All buttons…/);
    expect(html).toContain("L-watch");
  });

  it("an arm: true face button keeps arming (it carries no armed look until tapped)", () => {
    const html = renderToStaticMarkup(
      <GuestCardBody session={fakeSession({ objectives: [obj("y2k", ["patch_a"])] })} guestId="g-1" seed={{ card: card(["patch_a"]) }} admin={false} onOpenThread={() => {}} />,
    );
    expect(html).toContain("L-patch_a");
    expect(html).not.toContain("armed");
  });
});

describe("what a press or a scan came to (C1, fix round)", () => {
  it("shows the story's replies, the character's lines and the staff room's refusal", () => {
    expect(pressOutcome({ replies: ["✅ Cleared Ada."] }, "press")).toEqual([{ kind: "reply", text: "✅ Cleared Ada." }]);
    expect(pressOutcome({ replies: [], said: [{ from: "McAfee Anti-Virus", text: "Not yet. Finish your upload." }] }, "scan")).toEqual([
      { kind: "said", from: "McAfee Anti-Virus", text: "Not yet. Finish your upload." },
    ]);
    // The bottle was on someone else: the story refused, and said why only in # hosts.
    expect(pressOutcome({ replies: [], staff: ["🗣 The bottle is not on WinZip."], refused: true }, "press")).toEqual([{ kind: "staff", text: "🗣 The bottle is not on WinZip.", refused: true }]);
    // A staff line from a press that worked (the story's own note in # quarantine) is no refusal.
    expect(pressOutcome({ replies: [], staff: ["🛡 Escort WinZip to the Internet."] }, "press")).toEqual([{ kind: "staff", text: "🛡 Escort WinZip to the Internet.", refused: false }]);
  });

  it("never a bare ✔: nothing back reads 'no reply from the story'", () => {
    expect(pressOutcome({}, "press")).toEqual([{ kind: "none", text: "✔ Sent — no reply from the story" }]);
    expect(pressOutcome({ replies: [" "], said: [], staff: [] }, "scan")).toEqual([{ kind: "none", text: "✔ Scanned — no reply from the story" }]);
  });

  it("renders on a scan's card: the line, the refusal, or the no-reply note", () => {
    const render = (seed: Parameters<typeof GuestCardBody>[0]["seed"]) =>
      renderToStaticMarkup(<GuestCardBody session={fakeSession()} guestId="g-1" seed={seed} admin={false} onOpenThread={() => {}} />);
    const said = render({ card: card(["send"]), replies: [], said: [{ from: "McAfee Anti-Virus", text: "Not yet. Finish your upload." }] });
    expect(said).toContain("McAfee Anti-Virus:");
    expect(said).toContain("Not yet. Finish your upload.");
    const refused = render({ card: card(["send"]), replies: [], staff: ["🗣 The bottle is not on WinZip."], refused: true });
    expect(refused).toContain("booth-reply w95-inset refused");
    expect(refused).toContain("Not done:");
    expect(refused).toContain("The bottle is not on WinZip.");
    expect(refused).not.toContain("✔");
    // Staff lines without the server's verdict: shown as the staff room's, never "Not done", never a ✔.
    const noted = render({ card: card(["send"]), replies: [], staff: ["🛡 Escort WinZip to the Internet."] });
    expect(noted).toContain("Staff room:");
    expect(noted).toContain("Escort WinZip to the Internet.");
    expect(noted).not.toContain("Not done:");
    expect(noted).not.toContain("refused");
    expect(noted).not.toContain("✔");
    expect(render({ card: card(["send"]), replies: [] })).toContain("✔ Scanned — no reply from the story");
    // A card opened from Guests (no scan) says nothing about a press.
    expect(render({ card: card(["send"]) })).not.toContain("no reply from the story");
  });
});

describe("📡 Scan again (fix round)", () => {
  it("takes the server's 'scanned a moment ago' (429) as no new scan, never an error", () => {
    expect(scanRepeated(new ApiError("scanned a moment ago", 429))).toBe(true);
    expect(scanRepeated(new ApiError("too many requests", 429))).toBe(false);
    expect(scanRepeated(new ApiError("scanned a moment ago", 409))).toBe(false);
    expect(scanRepeated(new Error("scanned a moment ago"))).toBe(false);
  });

  it("runs one scan at a time and ignores taps until the reply", async () => {
    const gate = inFlightGate();
    let calls = 0;
    let finish: (v: string) => void = () => {};
    const start = () => {
      calls += 1;
      return new Promise<string>((r) => (finish = r));
    };
    const first = gate.run(start);
    expect(first).not.toBeNull();
    for (let n = 0; n < 19; n += 1) expect(gate.run(start)).toBeNull();
    expect(calls).toBe(1);
    expect(gate.busy()).toBe(true);
    finish("ok");
    await first;
    expect(gate.busy()).toBe(false);
    expect(gate.run(start)).not.toBeNull();
    expect(calls).toBe(2);
  });

  it("opens again after a failed scan", async () => {
    const gate = inFlightGate();
    await gate.run(() => Promise.reject(new Error("doors are closed")))?.catch(() => {});
    expect(gate.busy()).toBe(false);
  });
});

describe("the All buttons fold (fix round)", () => {
  const many = Array.from({ length: FOLD_AUTO_MAX + 1 }, (_, n) => btn(`b${n}`));
  it("opens by itself only when it is short; Clippy's long fold stays shut behind its count", () => {
    const short = cardButtons(many.slice(0, FOLD_AUTO_MAX), [obj("a", ["nope"])], card(["b0"]), NORTON, false);
    expect(foldOpensItself(short, true)).toBe(true);
    const long = cardButtons(many, [obj("a", ["nope"])], card(["b0"]), NORTON, false);
    expect(long.rest.length).toBe(FOLD_AUTO_MAX + 1);
    expect(foldOpensItself(long, true)).toBe(false);
    expect(foldOpensItself(short, false)).toBe(false); // no card read yet
    const html = renderToStaticMarkup(
      <GuestCardBody session={fakeSession({ interactions: many, objectives: [obj("a", ["nope"])] })} guestId="g-1" seed={{ card: card(["b0"]) }} admin={false} onOpenThread={() => {}} />,
    );
    expect(html).toContain("Nothing your objective needs on Ada right now.");
    expect(html).toMatch(/aria-expanded="false"[^>]*>▸ All buttons… \(7\)/);
    expect(html).not.toContain("L-b0");
  });
});

describe("lean snapshots and the host flag (C3 / C4, fix round)", () => {
  const ada = (flags: PrimeGuest["flags"]): PrimeGuest => ({ id: "g-1", name: "Ada", faction: null, captured: false, location: "Desktop", ...(flags !== undefined ? { flags } : {}) });
  const cleared = { label: "Cleared", path: "program.cleared", value: "false", on: false };
  const marked = { label: "Marked", path: "program.marked", value: "true", on: true };
  const late = { label: "Late", path: "program.late", value: "false", on: false };
  const uploaded = { label: "Uploaded", path: "program.uploaded", value: "false", on: false };

  it("reads the same facts from a lean snapshot row (on flags + failed gates) as from the full list", () => {
    const full = factChips(ada([cleared, marked, late]), "The Desktop");
    expect(factChips(ada([cleared, marked]), "The Desktop")).toEqual(full);
    // No flags at all in a lean row: nothing to say beyond where they are.
    expect(factChips(ada(undefined), "The Desktop")).toEqual([{ text: "📍 The Desktop", tone: "quiet" }]);
  });

  it("tops a lean row up with a failed gate only the card's own read carries; the row's own labels win", () => {
    const row = ada([marked]);
    const read = ada([uploaded, marked, late]);
    expect(cardGuestFacts(row, read)?.flags).toEqual([marked, uploaded]);
    // The gate passed since the card was read: the row's on flag wins.
    expect(cardGuestFacts(ada([{ ...uploaded, value: "true", on: true }]), read)?.flags).toEqual([{ ...uploaded, value: "true", on: true }]);
    expect(cardGuestFacts(null, read)).toBe(read);
    expect(cardGuestFacts(row, null)).toBe(row);
    expect(cardGuestFacts(row, { ...read, id: "g-2" })).toBe(row);
  });

  it("the host flag follows the latest view, else the sign-in's answer", () => {
    expect(boothHost({ host: false }, { host: true })).toBe(true); // granted after a reload
    expect(boothHost({ host: true }, {})).toBe(true); // an older server's view
    expect(boothHost({ host: false }, null)).toBe(false);
    expect(boothHost(null, undefined)).toBe(false);
    // A newer server says host: false on every view: a host taken away is gone.
    expect(boothHost({ host: true }, { host: false })).toBe(false);
  });

  it("a host booth (from the view) gets another character's by: button in the fold", () => {
    const session = { ...fakeSession({ host: true }), auth: { token: "t", character: NORTON, admin: false, host: false, eventId: "default" } } as unknown as PrimeSession;
    const html = renderToStaticMarkup(<GuestCardBody session={session} guestId="g-1" seed={{ card: card(["send"]) }} admin={false} onOpenThread={() => {}} />);
    // Folded, but counted: Vouch (Clippy's `by:`) is in it for a host booth only.
    expect(html).toContain("All buttons… (6)");
    const plain = renderToStaticMarkup(<GuestCardBody session={fakeSession()} guestId="g-1" seed={{ card: card(["send"]) }} admin={false} onOpenThread={() => {}} />);
    expect(plain).toContain("All buttons… (5)");
  });
});
