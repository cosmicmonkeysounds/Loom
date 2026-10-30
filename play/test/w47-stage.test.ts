// Wave 47: the upload's questions never take the conversation over. Seen in
// Chrome at 390x700: the deposit write-in, the 🎥 video question, the inbox
// and the pass all landed inline within seconds, the lines asking them
// scrolled away, and a "Show your pass" banner over the stage said what the
// pass card and the stage's My pass already said.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stageTray } from "../src/cutscene.tsx";
import { trayIndex } from "../src/stream/card-tray.tsx";
import type { ChatMessage } from "../src/types.ts";

let seq = 1;
const m = (extra: Partial<ChatMessage>): ChatMessage => ({
  seq: seq++, channel: "dm:Task Manager", channelKind: "dm", title: "Task Manager", from: "Task Manager", kind: "line", text: "x", ts: 0, audience: ["g1"], parentSeq: null, hidden: false, beat: "Upload Deposit", ...extra,
});
const card = (kind: string, text: string, params: Record<string, string> = {}) => m({ kind: "widget", widget: { kind, text, params } });

describe("the stage's tray (wave 47)", () => {
  const captcha = card("captcha", "Select every square", { target: "traffic light" });
  const deposit = card("answer", "What did you leave in the deposit box?", { max: "80", stage: "true" });
  const video = card("poll", "🎥 May video of you from tonight be used?", { options: "Yes, use video of me | No, leave me out" });
  const inbox = card("email", "Your human inbox, for Jean Trabolta's letter. Optional.", { button: "Send me the letter", skip: "No thanks" });
  const pass = card("pass", "Hold this up.");
  const all = [captcha, deposit, video, inbox, pass];

  it("docks every live question but the CAPTCHA (the scene) and the pass (not a question), oldest first", () => {
    expect(stageTray(all, new Map()).map((x) => x.widget?.kind)).toEqual(["answer", "poll", "email"]);
  });
  it("an answered card leaves the tray (its receipt settles in the stream)", () => {
    expect(stageTray(all, new Map([[deposit.seq, { text: "My car keys" }]])).map((x) => x.widget?.kind)).toEqual(["poll", "email"]);
  });
  it("the stage's tray leads with the oldest card; a room's with the newest", () => {
    const cards = [deposit, video, inbox];
    expect(trayIndex(cards, null, "oldest")).toBe(0);
    expect(trayIndex(cards, null)).toBe(2);
    expect(trayIndex(cards, video.seq, "oldest")).toBe(1);
  });
});

describe("the stage's wiring (wave 47)", () => {
  const cut = readFileSync(new URL("../src/cutscene.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/guest/app.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/css/stream.css", import.meta.url), "utf8");
  it("the tray docks in the foot, oldest first, after the line asking it has crawled in", () => {
    expect(cut).toMatch(/<CardTray cards=\{cards\}[^>]*lead="oldest"/u);
    expect(cut).toMatch(/useDockReady\(PERSONAL_STREAM, messages, decision !== null \|\| cards\.length > 0\)/u);
  });
  it("the loud pass objective lights My pass instead of raising a banner over the stage", () => {
    expect(cut).toMatch(/className=\{`cut-pass\$\{passLit \? " lit" : ""\}`\}/u);
    expect(app).toMatch(/nowBar: !cut\.showing \|\| \(st\.objectives \?\? \[\]\)\.some\(\(o\) => o\.loud === true && o\.buttons\.includes\("pass"\)\)/u);
  });
  it("the foot never takes more than 55% of the stage; the conversation keeps 120 px", () => {
    expect(css).toContain(".cut-foot { max-height: 55%;");
    expect(css).toContain(".cutscene > .thread { min-height: 120px; }");
    expect(css).toContain(".cut-foot .stream-tray-body { max-height: 34vh; max-height: 34dvh; }");
  });
});
