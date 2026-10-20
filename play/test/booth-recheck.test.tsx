// Wave 13 recheck (cbooth lane): the booth fixes the live recheck asked for —
// destructive presses set apart and armed, a face that holds still after a
// press, the scanner's paused copy, the staff rooms' preview, the late
// list folded into one moment, the guest thread's DM chip and the NOW bar
// greyed while paused. Message shapes are the ones off a real booth stream.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { armsFirst, defaultFaceId, destructive, faceGroups, heldFace, scanError, staffRow, type CardButton } from "../src/booth/model.ts";
import { BURST_MS, boothMomentFeed, burstLine, burstNames, staffMoment } from "../src/booth/moments-feed.ts";
import { guestThreadView } from "../src/booth/app.tsx";
import { NowCard, PAUSED } from "../src/booth/now-card.tsx";
import { GuestCardBody } from "../src/booth/card.tsx";
import { BOOTH_ICON_NAMES, BoothIcon } from "../src/booth/icons.tsx";
import { momentOf } from "../src/moments/model.ts";
import { boothAlertFilter } from "../src/alerts.ts";
import type { PrimeSession } from "../src/session/prime.ts";
import type { Channel, ChatMessage, GuestCardView, Interaction, ObjectiveView, PrimeView } from "../src/types.ts";

const i = (id: string, label: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label, who: "performer", description: null, ...extra });
const live = (x: Interaction, named = false): CardButton => ({ interaction: x, live: true, ...(named ? { named: true } : {}) });

// The show's labels, as the booth view carries them.
const SEND = i("send to the internet", "🛡 Send to the Internet");
const WATCH = i("accuse", "👁 Put on the watchlist");
const REFUSED = i("truth_refused", "🙅 Truth refused: marked for reinstallation");
const UNCERTAIN = i("uncertain_answer", "🤷 Uncertain or guessed: marked for reinstallation");
const UNMARK = i("unmark_for_reinstallation", "🩹 Unmark: not going to the Internet");
const REINSTALLED = i("mark as reinstalled", "✅ Mark as reinstalled");
const ANSWERED = i("truth_answered", "🗣 Truth answered: accepted");
const CHECKIN = i("check_in_at_desktop", "📍 Checked in at the Desktop");
const VOUCH = i("vouch", "🤝 Vouch for this program");
const PATCH = i("radio_combo_a", "🔌 Patch: Combo A is in", { arm: true });

describe("destructive presses (finish review #4)", () => {
  it("capture / mark / refuse → marked / the watchlist are destructive; taking a mark back never is", () => {
    for (const x of [SEND, WATCH, REFUSED, UNCERTAIN]) expect(destructive(x)).toBe(true);
    for (const x of [UNMARK, REINSTALLED, ANSWERED, CHECKIN, VOUCH, PATCH]) expect(destructive(x)).toBe(false);
  });
  it("arm first: the story's arm: true, and every destructive press whatever the story says", () => {
    expect(armsFirst(SEND)).toBe(true);
    expect(armsFirst(REFUSED)).toBe(true);
    expect(armsFirst(PATCH)).toBe(true);
    expect(armsFirst(ANSWERED)).toBe(false);
  });
  it("sit in their own group above the harmless ones, and are never the Win95 default button", () => {
    const face = [live(SEND, true), live(ANSWERED, true), live(REFUSED)];
    const { harm, safe } = faceGroups(face);
    expect(harm.map((b) => b.interaction.id)).toEqual(["send to the internet", "truth_refused"]);
    expect(safe.map((b) => b.interaction.id)).toEqual(["truth_answered"]);
    // Windows Defender's door: 🛡 is the objective's only face button, and still never the default.
    expect(defaultFaceId([live(SEND, true)])).toBeNull();
    expect(defaultFaceId(face)).toBe("truth_answered");
    // Nor a patch-bay radio (arm: true): the Y2K hour's face had 🔌 Combo A framed as the obvious tap.
    expect(defaultFaceId([live(PATCH, true), live(CHECKIN, true)])).toBe("check_in_at_desktop");
    expect(defaultFaceId([live(PATCH, true)])).toBeNull();
  });
});

describe("the face holds still after a press (finish review #4)", () => {
  const all = [SEND, WATCH, CHECKIN, ANSWERED, VOUCH];
  it("without a press, the face is the card's own", () => {
    const r = heldFace([live(CHECKIN), live(WATCH)], [live(VOUCH)], null, all);
    expect(r.face.map((b) => b.interaction.id)).toEqual(["check_in_at_desktop", "accuse"]);
  });
  it("a button that left the face stays in its place, spent; one still live in the fold stays pressable there", () => {
    // Pressed 🛡: it left the face (the guest is captured now) and is not live anywhere.
    const r = heldFace([live(WATCH)], [{ interaction: VOUCH, live: true }], ["send to the internet", "accuse"], all);
    expect(r.face.map((b) => [b.interaction.id, b.gone === true])).toEqual([["send to the internet", true], ["accuse", false]]);
    // Pressed 📍: it left the face but is live in the fold → kept on the face, live, and out of the fold.
    const s = heldFace([live(WATCH)], [{ interaction: CHECKIN, live: true }, { interaction: VOUCH, live: true }], ["check_in_at_desktop", "accuse"], all);
    expect(s.face.map((b) => [b.interaction.id, b.live])).toEqual([["check_in_at_desktop", true], ["accuse", true]]);
    expect(s.rest.map((b) => b.interaction.id)).toEqual(["vouch"]);
  });
  it("a new face button joins at the top, so the rows under the thumb (the bottom) never move", () => {
    const r = heldFace([live(ANSWERED), live(WATCH)], [], ["accuse"], all);
    expect(r.face.map((b) => b.interaction.id)).toEqual(["truth_answered", "accuse"]);
  });
});

describe("a scan turned down (recheck nit)", () => {
  it("a paused show reads as paused, never the raw 'doors are closed'", () => {
    const e = new Error("doors are closed");
    expect(scanError(e, { paused: true, night: { step: 7 } })).toBe("The show is paused: scan again when it resumes.");
    expect(scanError(e, { paused: true, night: { step: 0 } })).toBe("The doors aren't open yet: scan again once they are.");
    expect(scanError(new Error("unknown guest"), null)).toBe("That pass isn't a guest in this event.");
    expect(scanError(new Error("boom"), null)).toBe("boom");
  });
});

// The real shapes off Password Manager's stream (scratch server, 2026-10-20).
let seq = 900;
const hostsLine = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  channel: "room:hosts", channelKind: "faction", title: "# hosts", from: "Task Manager", kind: "line", text: "Password Manager: the patch bay, NOW.", ts: 12000, audience: [], parentSeq: null, seq: seq++, hidden: false, ...over,
}) as ChatMessage;
const late = (name: string, about: string, ts: number, glyph = "⏰", over: Partial<ChatMessage> = {}): ChatMessage => ({
  channel: "dm:McAfee Anti-Virus", channelKind: "dm", title: "McAfee Anti-Virus", from: "", kind: "narration", alert: true, readout: true, about,
  text: glyph === "⏰" ? `⏰ ${name} is late for the Second Moment of Truth. Go get them.` : `🚨 ${name} is marked for reinstallation (late for the Second Moment of Truth). Escort them through the Tube, then press 🛡 on their card.`,
  ts, audience: ["@McAfee Anti-Virus"], parentSeq: null, seq: seq++, hidden: false, ...over,
}) as ChatMessage;

describe("staff rooms in a booth (recheck MAJOR)", () => {
  const STAFF = new Set(["room:hosts", "room:quarantine"]);
  it("a host's or a director's line, or a story note naming the booth, raises a minor moment", () => {
    expect(staffMoment(hostsLine(), { character: "Password Manager", staffRooms: STAFF })).toBe(true);
    expect(staffMoment(hostsLine({ from: "Operator", text: "Everyone to the Desktop." }), { character: "Norton Anti-Virus", staffRooms: STAFF })).toBe(true);
    expect(staffMoment(hostsLine({ from: "", kind: "signal", text: "Norton Anti-Virus, the bottle is yours." }), { character: "Norton Anti-Virus", staffRooms: STAFF })).toBe(true);
  });
  it("never the booth's own line, a story note that names someone else, a room that is not staff, or one already a moment", () => {
    expect(staffMoment(hostsLine({ from: "Password Manager" }), { character: "Password Manager", staffRooms: STAFF })).toBe(false);
    expect(staffMoment(hostsLine({ from: "", kind: "signal", text: "🛡 Escort WinZip to the Internet." }), { character: "Norton Anti-Virus", staffRooms: STAFF })).toBe(false);
    expect(staffMoment(hostsLine({ channel: "loc:The Desktop" }), { character: "Password Manager", staffRooms: STAFF })).toBe(false);
    expect(staffMoment(hostsLine({ alert: true }), { character: "Password Manager", staffRooms: STAFF })).toBe(false);
  });
  it("the stamped line becomes the balloon the moments layer shows, its exit the staff room", () => {
    const m = hostsLine();
    const feed = boothMomentFeed(new Map([[m.seq, m]]), { character: "Password Manager", staffRooms: STAFF, guestName: () => null, names: [] });
    const out = feed.get(m.seq)!;
    expect(out.moment).toBe("minor");
    const viewer = { role: "booth" as const, me: "Password Manager", filter: boothAlertFilter("Password Manager") };
    const moment = momentOf(out, viewer, null);
    expect(moment).toMatchObject({ severity: "minor", caption: "Task Manager", channel: "room:hosts" });
    // Unstamped, the layer had nothing for it.
    expect(momentOf(m, viewer, null)).toBeNull();
  });
  it("the room's row previews the newest line once there is one, else says staff only", () => {
    const room = (messages: ChatMessage[]): Channel => ({ id: "room:hosts", kind: "faction", title: "# hosts", subtitle: "staff only", staff: true, spaceId: "staff", order: 0, messages, unread: 0, decision: null, lastTs: 0 }) as Channel;
    expect(staffRow(room([])).subtitle).toBe("staff only");
    expect(staffRow(room([hostsLine()])).subtitle).toBeUndefined();
    expect(staffRow(room([hostsLine({ ambient: true })])).subtitle).toBe("staff only");
  });
});

describe("the late list folds into one moment per kind (recheck nit)", () => {
  const guests = new Map([["g-1", "WinZip"], ["g-2", "GarageBand"], ["g-3", "Calculator2"], ["g-4", "Zoo Tycoon"], ["g-5", "LimeWire"], ["g-6", "MSN Messenger"]]);
  const opts = { character: "McAfee Anti-Virus", staffRooms: new Set<string>(), guestName: (id: string) => guests.get(id) ?? null, names: [...guests.values()] };
  it("names the guests: A, A and B, A, B and C, A, B and n more", () => {
    expect(burstNames(["A"])).toBe("A");
    expect(burstNames(["A", "B"])).toBe("A and B");
    expect(burstNames(["A", "B", "C"])).toBe("A, B and C");
    expect(burstNames(["A", "B", "C", "D", "E", "F"])).toBe("A, B and 4 more");
  });
  it("six ⏰ and six 🚨 in the same second are two moments, the rest hidden from the layer only", () => {
    const list: ChatMessage[] = [];
    let n = 0;
    for (const [id, name] of guests) {
      list.push(late(name, id, 50_000 + n * 10));
      list.push(late(name, id, 50_000 + n * 10 + 5, "🚨"));
      n++;
    }
    const feed = boothMomentFeed(new Map(list.map((m) => [m.seq, m])), opts);
    const shown = [...feed.values()].filter((m) => !m.hidden);
    expect(shown.map((m) => m.text)).toEqual([
      "⏰ WinZip, GarageBand and 4 more are late for the Second Moment of Truth — see Readouts.",
      "🚨 WinZip, GarageBand and 4 more are marked for reinstallation (late for the Second Moment of Truth) — see Readouts.",
    ]);
    // The folded line is about nobody (a card open on one guest never swallows it).
    expect(shown.every((m) => m.about === undefined)).toBe(true);
    // The moments layer makes exactly two moments of it.
    const viewer = { role: "booth" as const, me: "McAfee Anti-Virus", filter: boothAlertFilter("McAfee Anti-Virus") };
    expect([...feed.values()].map((m) => momentOf(m, viewer, null)).filter((x) => x !== null)).toHaveLength(2);
  });
  it("reads the story's one-readout-per-late-program line (w13 Q31) the same way", () => {
    const one = (name: string, id: string, ts: number) => late(name, id, ts, "🚨", { text: `🚨 ${name} is late for the Second Moment of Truth: marked for reinstallation. Go get them, escort them through the Tube, then press 🛡 on their card.` });
    const list = [one("WinZip", "g-1", 1000), one("GarageBand", "g-2", 1004), one("LimeWire", "g-5", 1008)];
    const shown = [...boothMomentFeed(new Map(list.map((m) => [m.seq, m])), opts).values()].filter((m) => !m.hidden);
    expect(shown.map((m) => m.text)).toEqual(["🚨 WinZip, GarageBand and LimeWire are late for the Second Moment of Truth: marked for reinstallation — see Readouts."]);
  });
  it("readouts further apart than a burst, or one alone, stay as they are", () => {
    const a = late("WinZip", "g-1", 10_000);
    const b = late("GarageBand", "g-2", 10_000 + BURST_MS + 1);
    const m = new Map([[a.seq, a], [b.seq, b]]);
    const out = boothMomentFeed(m, opts);
    expect([...out.values()].map((x) => [x.text, x.hidden])).toEqual([[a.text, false], [b.text, false]]);
  });
  it("captions a readout's moment 'Readout', never the booth's own name", () => {
    const a = late("WinZip", "g-1", 10_000);
    const out = boothMomentFeed(new Map([[a.seq, a]]), opts);
    const viewer = { role: "booth" as const, me: "McAfee Anti-Virus", filter: boothAlertFilter("McAfee Anti-Virus") };
    expect(momentOf(out.get(a.seq)!, viewer, null)?.caption).toBe("Readout");
    // A map with nothing to change is handed back as it is.
    const quiet = new Map([[1, hostsLine({ channel: "loc:The Desktop" })]]);
    expect(boothMomentFeed(quiet, opts)).toBe(quiet);
  });
  it("another shape says the newest line and how many more", () => {
    expect(burstLine("🚨 Server room alarm: \u0000 at the patch bay.", ["WinZip", "LimeWire"], 2)).toBe("🚨 Server room alarm: LimeWire at the patch bay. (+1 more like it — see Readouts)");
  });
});

describe("a guest's thread in a booth (recheck nit)", () => {
  it("the booth's own DM rows read 'DM', never the character's own name as a room chip", () => {
    const own = { ...hostsLine(), channel: "dm:Door Dee", channelKind: "dm", title: "Door Dee", from: "Encarta", text: "Is the party open yet?", audience: ["g-9"] } as ChatMessage;
    const card = { ...hostsLine(), channel: "loc:Plain Party", channelKind: "location", title: "Plain Party", from: "" } as ChatMessage;
    const c = { id: "guest:g-9", kind: "guest", title: "Encarta", spaceId: "guests", order: 0, messages: [own, card], unread: 0, decision: null, lastTs: 0 } as Channel;
    const v = guestThreadView(c, "Door Dee");
    expect(v.messages.map((m) => m.title)).toEqual(["DM", "Plain Party"]);
    // The same object every render (the stream's crawl and keys see one row).
    expect(guestThreadView(c, "Door Dee").messages[0]).toBe(v.messages[0]);
    expect(guestThreadView(c, "Clippy")).toBe(c);
  });
});

describe("the booth NOW bar while paused (D3)", () => {
  const o: ObjectiveView = { id: "door", title: "Hold the door", brief: "", checklist: [], buttons: [], act: null };
  it("greys out and says (Paused), like the guest's", () => {
    const paused = renderToStaticMarkup(<NowCard objectives={[o]} interactions={[]} character="Norton" pill={null} closeKey={null} paused />);
    expect(paused).toContain("booth-now-bar paused");
    expect(paused).toContain(`Hold the door${PAUSED}</span>`);
    const idle = renderToStaticMarkup(<NowCard objectives={[]} interactions={[]} character="Norton" pill={null} closeKey={null} paused />);
    expect(idle).toContain("booth-now-bar idle paused");
    expect(renderToStaticMarkup(<NowCard objectives={[o]} interactions={[]} character="Norton" pill={null} closeKey={null} />)).not.toContain("paused");
  });
});

describe("the card as rendered after the recheck", () => {
  const view = (objectives: ObjectiveView[]): PrimeView => ({ character: "Windows Defender", guests: [], channels: [], interactions: [SEND, CHECKIN, VOUCH], objectives }) as unknown as PrimeView;
  const session = (v: PrimeView) => ({ auth: { token: "t", character: "Windows Defender", admin: false, eventId: "default" }, view: v, card: () => new Promise<never>(() => {}) }) as unknown as PrimeSession;
  const seed = (live: string[]): { card: GuestCardView; replies: string[] } => ({ card: { guest: { id: "g-1", name: "Netscape Navigator", faction: null, captured: false, location: null }, live, guestScoped: [], readouts: [] }, replies: ["✅ Cleared Netscape Navigator."] });
  it("puts the face and Next guest in the pinned foot, the destructive press under its warning and never the default", () => {
    const html = renderToStaticMarkup(
      <GuestCardBody session={session(view([{ id: "hold", title: "Hold", brief: "", checklist: [], buttons: ["scan", "send to the internet", "check_in_at_desktop"], act: null }]))} guestId="g-1" seed={seed(["send to the internet", "check_in_at_desktop", "vouch"])} admin={false} onOpenThread={() => {}} onNext={() => {}} />,
    );
    const foot = html.slice(html.indexOf("booth-card-foot"));
    expect(foot).toContain("Marks or captures Netscape Navigator: tap twice");
    expect(foot.indexOf("🛡 Send to the Internet")).toBeLessThan(foot.indexOf("📍 Checked in at the Desktop"));
    expect(foot.indexOf("📍 Checked in at the Desktop")).toBeLessThan(foot.indexOf("Next guest"));
    // The default frame goes to the harmless 📍, never to 🛡.
    expect(html).toMatch(/booth-face-btn booth-default[^"]*"[^>]*><span class="booth-btn-label">📍/u);
    expect(html).toMatch(/booth-face-btn harm/u);
    expect(html).not.toMatch(/booth-default harm/u);
    // The reply stays above, in the part that scrolls.
    expect(html.indexOf("✅ Cleared Netscape Navigator.")).toBeLessThan(html.indexOf("booth-card-foot"));
  });
  it("draws its utility icons (no emoji in the card's chrome)", () => {
    const html = renderToStaticMarkup(<GuestCardBody session={session(view([]))} guestId="g-1" seed={seed([])} admin={false} onOpenThread={() => {}} onNext={() => {}} />);
    for (const name of ["message", "rescan"]) expect(html).toContain(`ico-${name}`);
    expect(html).not.toContain("💬");
    expect(html).not.toContain("📡");
    expect(html).not.toContain("📷");
  });
  it("every booth icon draws", () => {
    for (const name of BOOTH_ICON_NAMES) expect(renderToStaticMarkup(<BoothIcon name={name} />)).toContain(`ico-${name}`);
  });
});
