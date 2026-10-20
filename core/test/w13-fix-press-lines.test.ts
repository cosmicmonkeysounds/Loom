//! Wave 13 fix round, C1: `/api/prime/act` and `/api/scan` replies carry
//! `staff` (the staff-room lines the press produced — a refusal's reason,
//! "🗣 The bottle is not on WinZip.") and `said` (what the booth's character
//! said to the guest, "Not yet. Finish your upload."), so a card never reads
//! a bare ✔ for a press the story refused or answered only out loud.

import { afterAll, describe, expect, it } from "vitest";
import { pressLines } from "../server/routes/press-lines.ts";
import type { ChatMessage } from "../server/chat.ts";
import { scenarioSource } from "../examples/load.ts";
import { CODES, booth, cleanup, freshDir, guest, mod, post, runtime } from "./w13-fix-harness.ts";

afterAll(cleanup);

describe("C1: a press's and a scan's own lines", () => {
  it("pressLines: staff-room rows, the character's lines to the guest, nothing else", () => {
    const row = (p: Partial<ChatMessage>): ChatMessage =>
      ({ seq: 1, channel: "lobby", channelKind: "lobby", title: "", from: "", kind: "line", text: "x", ts: 0, audience: "all", parentSeq: null, hidden: false, ...p }) as ChatMessage;
    const out = pressLines(
      [
        row({ channel: "room:hosts", kind: "narration", text: "🗣 The bottle is not on WinZip." }),
        row({ channel: "dm:Norton", from: "Norton", audience: ["g1"], text: "Not yet." }),
        row({ channel: "dm:Norton", from: "Norton", audience: ["g2"], text: "someone else" }),
        row({ channel: "dm:Norton", from: "Norton", audience: ["g1"], text: "hidden", hidden: true }),
        row({ channel: "lobby", from: "Clippy", audience: "all", text: "public" }),
      ],
      new Set(["room:hosts"]),
      "Norton",
      "g1",
    );
    expect(out).toEqual({ staff: ["🗣 The bottle is not on WinZip."], said: [{ from: "Norton", text: "Not yet." }] });
    expect(pressLines([], new Set(), "Norton", "g1")).toEqual({});
  });

  it("a refused press answers its # hosts line as staff; an accepted one its reply; a silent one neither", async () => {
    const rt = runtime();
    rt.openDoors();
    const g = await guest(rt, "WinZip");
    const clippy = (await booth(rt, "Clippy")).json.token as string;
    const refused = await post(rt, "/api/prime/act", { name: "answered", guest: g.id, token: clippy });
    expect(refused.status).toBe(200);
    expect(refused.json).toMatchObject({ replies: [], staff: ["🗣 The bottle is not on WinZip."] });
    expect(refused.json.said).toBeUndefined();
    await mod(rt, "/api/mod/var", { path: "Night.bottle_open", value: "true" });
    const ok = await post(rt, "/api/prime/act", { name: "answered", guest: g.id, token: clippy });
    expect(ok.json).toMatchObject({ replies: ["Accepted."] });
    expect(ok.json.staff).toBeUndefined();
    const silent = await post(rt, "/api/prime/act", { name: "nudge", guest: g.id, token: clippy });
    expect(silent.json).toMatchObject({ replies: [] });
    expect(silent.json.staff).toBeUndefined();
    expect(silent.json.said).toBeUndefined();
  });

  it("a scan whose outcome is a spoken line answers it as said", async () => {
    const rt = runtime();
    rt.openDoors();
    const g = await guest(rt, "Minesweeper");
    const norton = (await booth(rt, "Norton")).json.token as string;
    const scan = await post(rt, "/api/scan", { target: g.id, token: norton });
    expect(scan.status).toBe(200);
    expect(scan.json).toMatchObject({ responses: [], said: [{ from: "Norton", text: "Not yet. Finish your upload." }] });
  });

  it(
    "the show: Clippy's 🗣 on a program the bottle is not on; an Antivirus scanning a guest mid-upload",
    async () => {
      const rt = runtime({ codes: CODES }, freshDir(), scenarioSource("trapped-in-the-internet"));
      rt.openDoors();
      const winzip = await guest(rt, "WinZip");
      const clippy = (await booth(rt, "Clippy")).json.token as string;
      const press = await post(rt, "/api/prime/act", { name: "truth_answered", guest: winzip.id, token: clippy });
      expect(press.status).toBe(200);
      expect(press.json.staff).toEqual(["🗣 The bottle is not on WinZip."]);
      const mine = await guest(rt, "Minesweeper");
      const mcafee = (await booth(rt, "McAfee Anti-Virus")).json.token as string;
      const scan = await post(rt, "/api/scan", { target: mine.id, token: mcafee });
      expect(scan.status).toBe(200);
      expect((scan.json.said as { text: string }[]).map((s) => s.text)).toEqual(["Not yet. Finish your upload. I will be right here."]);
    },
    60_000,
  );
});
