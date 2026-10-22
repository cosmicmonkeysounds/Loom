//! Wave 18b (R1): a clue or a room sign scanned in the app says it worked
//! and lands on the entry or the room; a miss or a refusal keeps the 📷
//! sheet open with the reason.

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiError } from "../src/client.ts";
import { REDEEM_THROTTLED } from "../src/codex.ts";
import {
  CHECKIN_KEPT,
  SCAN_DONE_ALREADY,
  SCAN_DONE_CHECKIN,
  SCAN_DONE_UNLOCK,
  SCAN_FAILED,
  SCAN_MISSED,
  SCAN_PAUSED,
  ScanDoneDialog,
  checkinOutcome,
  redeemOutcome,
  scanErrorNote,
} from "../src/scan-done.tsx";
import { codexRows } from "../src/stream/codex-groups.ts";
import { focusPlan } from "../src/stream/codex-room.tsx";
import type { ChatMessage, CodexCard } from "../src/types.ts";

describe("a redeem's answer", () => {
  it("a hit opens the Codex on the new entry", () => {
    expect(redeemOutcome({ unlocked: "cold_first", title: "The First Digit" })).toEqual({
      done: { title: SCAN_DONE_UNLOCK, body: "“The First Digit” is in your Codex now.", go: { to: "codex", entry: "cold_first" } },
    });
  });

  it("a code already held opens the Codex on the entry it names", () => {
    expect(redeemOutcome({ unlocked: null, already: "cold_first", title: "The First Digit" })).toEqual({
      done: { title: SCAN_DONE_ALREADY, body: "You already have “The First Digit”. Here it is.", go: { to: "codex", entry: "cold_first" } },
    });
  });

  it("a miss keeps the sheet open, and an old server's answer (no title, no missed) still reads", () => {
    expect(redeemOutcome({ unlocked: null, missed: true })).toEqual({ note: SCAN_MISSED });
    expect(redeemOutcome({ unlocked: null })).toEqual({ note: SCAN_MISSED });
    expect(redeemOutcome({ unlocked: "x" })).toEqual({ done: { title: SCAN_DONE_UNLOCK, body: "A new entry is in your Codex now.", go: { to: "codex", entry: "x" } } });
  });
});

describe("a check-in's answer", () => {
  it("in: the story's own lines over the room, else a plain line naming it", () => {
    expect(checkinOutcome({ at: "The_CPU", channel: "loc:The_CPU", moved: true, room: "The CPU", replies: ["📍 Checked in at the CPU.", " 📎 An aside. "] })).toEqual({
      done: { title: SCAN_DONE_CHECKIN, body: "📍 Checked in at the CPU.\n📎 An aside.", go: { to: "room", id: "loc:The_CPU" } },
    });
    expect(checkinOutcome({ at: "The_CPU", channel: "loc:The_CPU", moved: true, room: "The CPU", replies: [] })).toMatchObject({ done: { body: "You're checked in at The CPU." } });
    // An old server: no `room`, no `replies`.
    expect(checkinOutcome({ at: "The_CPU", channel: "loc:The_CPU", moved: true })).toMatchObject({ done: { body: "You're checked in at The_CPU." } });
  });

  it("kept out by the story: the sheet says the story's reason", () => {
    expect(checkinOutcome({ at: "The_CPU", channel: "loc:The_CPU", moved: false, replies: ["You are in the Internet."] })).toEqual({ note: "⛔ You are in the Internet." });
    expect(checkinOutcome({ at: "The_CPU", channel: "loc:The_CPU", moved: false })).toEqual({ note: CHECKIN_KEPT });
  });
});

describe("a refusal", () => {
  it("names the throttle, the pause, else the server's own words; a dropped line says to retry", () => {
    expect(scanErrorNote(new ApiError("too many wrong codes — wait a minute", 429), "unlock")).toBe(REDEEM_THROTTLED);
    expect(scanErrorNote(new ApiError("You just checked in — try again in 12s.", 429), "checkin")).toBe("⛔ You just checked in — try again in 12s.");
    expect(scanErrorNote(new ApiError("doors are closed", 409), "checkin")).toBe(SCAN_PAUSED);
    expect(scanErrorNote(new ApiError("doors are closed", 409), "unlock")).toBe(SCAN_PAUSED);
    expect(scanErrorNote(new ApiError("That room isn't open yet.", 403), "checkin")).toBe("⛔ That room isn't open yet.");
    expect(scanErrorNote(new TypeError("Failed to fetch"), "unlock")).toBe(SCAN_FAILED);
  });
});

describe("the dialog", () => {
  it("a Win95 alertdialog on a div (never <dialog>), the body a line each, an OK", () => {
    const html = renderToStaticMarkup(<ScanDoneDialog done={{ id: 3, title: SCAN_DONE_CHECKIN, body: "One.\nTwo.", go: { to: "room", id: "loc:x" } }} onClose={() => {}} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).not.toContain("<dialog");
    expect(html).toContain("📍 Checked in");
    expect(html).toMatch(/<p class="scan-done-line">One\.<\/p><p class="scan-done-line">Two\.<\/p>/u);
    expect(html).toContain(">OK</button>");
  });

  it("sits just under the pass and scan layers, styled by class only", () => {
    const css = readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.scan-done-layer \{[^}]*z-index: calc\(var\(--z-pass\) - 1\)/u);
    expect(css).not.toMatch(/:has\(/u);
  });
});

let seq = 1;
function entry(c: Partial<CodexCard> & { entry: string }): ChatMessage {
  return {
    seq: seq++, channel: "codex", channelKind: "codex", title: "Codex", from: "", kind: "codex", text: "Text.", ts: 0, audience: ["g1"], parentSeq: null, hidden: false,
    codex: { title: c.entry, about: null, via: "code", from: null, ...c },
  };
}

describe("the Codex lands on the scanned entry", () => {
  it("waits for the entry's card, unfolds its group, clears a filter that hides it", () => {
    const rows = codexRows([entry({ entry: "Alpha", category: "Facts" }), entry({ entry: "Beta", category: "Files" })]);
    expect(focusPlan(rows, "Gamma", "")).toBeNull();
    expect(focusPlan(rows, "Beta", "")).toEqual({ group: "Files", clearQuery: false });
    expect(focusPlan(rows, "Beta", "alpha")).toEqual({ group: "Files", clearQuery: true });
    expect(focusPlan(rows, "Beta", "files")).toEqual({ group: "Files", clearQuery: false });
  });

  it("rows are found under the room's own root, never by a page-wide id", () => {
    const src = readFileSync(new URL("../src/stream/codex-room.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/document\.getElementById/u);
    expect(src).toContain("data-codex-entry");
  });
});

describe("the wiring", () => {
  const app = readFileSync(new URL("../src/guest/app.tsx", import.meta.url), "utf8");
  const session = readFileSync(new URL("../src/session/guest.ts", import.meta.url), "utf8");
  it("the 📷 sheet no longer opens the Codex before the redeem answers", () => {
    expect(app).not.toMatch(/nav\.openRoom\(CODEX_ROOM/u);
  });
  it("the check-in call no longer swallows its refusal", () => {
    expect(session).toMatch(/const checkin = useCallback\(\(at: string\) => post<CheckinAnswer>\("\/api\/guest\/checkin", \{ at \}\), \[post\]\);/u);
  });
  it("a check-in's lines are recorded as the guest's own answer without a toast (the balloon repeating them drops)", () => {
    expect(session).toMatch(/raise\(line, \{ quiet: true, silent: true \}\)/u);
  });
});
