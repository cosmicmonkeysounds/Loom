// Wave 47: nothing says twice what the window on screen already says. Seen
// in the full-evening sweep at 390x700: every act change put a house banner
// over a guest's Mission saying what its new objective said, and Clippy's
// YOUR GAME IS ON floated over the Mission card it names ("▣ Go to Mission",
// on Mission).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adaptBoothMessage, type AdapterCtx, type Draft } from "../src/booth/popouts/model.ts";
import { MISSION_ECHO_MS, echoesMission } from "../src/moments/model.ts";
import type { BoothMessage } from "../src/booth/wire.ts";

describe("a house banner that says what Mission says (wave 47)", () => {
  const at = 600_000;
  const pairs: Array<[string, string]> = [
    ["🎱 COMPUTER BINGO has begun. 20 minutes.", "Computer Bingo: find a program for each square"],
    ["🔎 THE TRUTH SCAVENGER HUNT has begun. Three questions are in your Quest Log. 15 minutes.", "The Truth Scavenger Hunt: find three facts"],
    ["📣 ALL PROGRAMS: report to the Desktop. A game is about to begin.", "Go to the Desktop: a game is about to begin"],
    ["🤖 TRABOLTA IS ONLINE. Jean Trabolta, Sole Owner and Founder of Maps and Ducks.", "Meet Trabolta, Sole Owner and Founder of Maps and Ducks"],
    ["📣 Time is up. Return to the Desktop for the First Moment of Truth.", "The First Moment of Truth"],
    ["🏓 TRUTH PONG. To the Cloud, out back: sink a cup and you may answer one fact.", "Truth Pong: sink a cup to answer a fact"],
    ["🏆 THE AWARDS CEREMONY. Every program to the living room.", "To the living room for the awards"],
  ];
  it.each(pairs)("%s echoes “%s” in the same beat", (text, title) => {
    expect(echoesMission({ text, at }, { title, since: at - 2_000 })).toBe(true);
  });
  it("a new quest's balloon echoes its objective too", () => {
    expect(echoesMission({ text: "New quest: Computer Bingo\nMingle and find a program for every square. The centre square matters.", at }, { title: "Computer Bingo: find a program for each square", since: at })).toBe(true);
    expect(echoesMission({ text: "New quest: The Truth Scavenger Hunt · Round 1\nThere are five facts to find.", at }, { title: "The Truth Scavenger Hunt: find three facts", since: at })).toBe(true);
  });
  it("one with news of its own stays a banner", () => {
    expect(echoesMission({ text: "📥 TRUTHER DOWNLOAD received. Check your messages.", at }, { title: "Round 2: one hour to find three facts", since: at })).toBe(false);
    expect(echoesMission({ text: "⏰ BINGO! Winamp called it. Back to the Desktop to hear the line.", at }, { title: "The Bingo results: cheer for the winners", since: at })).toBe(false);
  });
  it("only in the same beat: an old objective is no echo", () => {
    expect(echoesMission({ text: "🎱 COMPUTER BINGO has begun.", at }, { title: "Computer Bingo: find a program for each square", since: at - MISSION_ECHO_MS - 1 })).toBe(false);
    expect(echoesMission({ text: "🎱 COMPUTER BINGO has begun.", at }, null)).toBe(false);
  });
  it("the guest app passes the echo only while Mission is on screen, and blinks the title bar", () => {
    const app = readFileSync(new URL("../src/guest/app.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/\.\.\.\(onMission && nav\.overlay === null && !cut\.showing && !s\.locked/u);
    expect(app).toMatch(/<NowBar\s+news=\{missionNews\}/u);
    const provider = readFileSync(new URL("../src/moments/provider.tsx", import.meta.url), "utf8");
    expect(provider).toMatch(/window\.setTimeout\(\(\) => \{\s*for \(const m of hold\)/u);
    // A new quest too ("New quest: Computer Bingo" over Mission's Computer Bingo).
    expect(provider).toMatch(/return m\.severity !== "big" && \(isHouseAlert\(m\) \|\| m\.kind === "quest"\);/u);
  });
});

describe("YOUR GAME IS ON on Mission (wave 47)", () => {
  const game: BoothMessage = { seq: 41, channel: "dm:Clippy", channelKind: "dm", title: "", from: "Clippy", kind: "line", text: "!!🎱 YOUR GAME IS ON · The Bingo results. Demand applause.", ts: 0, audience: ["@Clippy"], parentSeq: null, hidden: false, moment: "big" } as unknown as BoothMessage;
  const base: AdapterCtx = { wanted: null, openGuest: () => null, guestName: () => null, me: "Clippy", player: true };
  it("pops while Mission is off screen", () => {
    const d = adaptBoothMessage(game, { ...base, missionOnScreen: () => false });
    expect(d !== null && d !== "default" && d.key).toBe("game:41");
  });
  it("on Mission it never pops: the booth chimes and blinks instead", () => {
    const quiet: Draft[] = [];
    expect(adaptBoothMessage(game, { ...base, missionOnScreen: () => true, onQuietGame: (g) => quiet.push(g) })).toBe(null);
    expect(quiet.map((g) => g.key)).toEqual(["game:41"]);
  });
  it("one held under a card is moot once Mission is on screen", () => {
    const src = readFileSync(new URL("../src/booth/popouts/use-booth-popouts.ts", import.meta.url), "utf8");
    expect(src).toMatch(/e\.spec\.key\.startsWith\("game:"\) && headId !== "" && missionShown\?\.\(headId\) === true/u);
  });
});

describe("a line about an objective that ended (wave 47)", () => {
  // Seen in Chrome: "🚨 You are marked for reinstallation…" waited behind
  // CORRUPTION DETECTED and the release, and showed after Collect.
  it("leaves the queue (and the missed list) when its objective ends", async () => {
    const { EMPTY_MOMENTS, momentsReducer, sharesTitle } = await import("../src/moments/model.ts");
    const marked = { key: "m:7", seq: 7, severity: "minor", kind: "alert", caption: "For you", text: "🚨 You are marked for reinstallation (flagged by a host). Nothing is switched off: carry on.", channel: "dm:Antivirus", at: 1, phase: null } as const;
    const coins = { ...marked, key: "m:8", seq: 8, text: "🪙 +5 Truthcoin from Clippy." };
    const s0 = { ...EMPTY_MOMENTS, queue: [{ moment: marked, level: "balloon", queuedAt: 0 }, { moment: coins, level: "balloon", queuedAt: 0 }], missed: [marked] } as never;
    const s1 = momentsReducer(s0, { type: "objectives", live: new Set(["explore"]), ended: ["You are marked for reinstallation"] });
    expect(s1.queue.map((q) => q.moment.key)).toEqual(["m:8"]);
    expect(s1.missed).toEqual([]);
    expect(sharesTitle(coins.text, "You are marked for reinstallation")).toBe(false);
    // Nothing ended: nothing goes.
    expect(momentsReducer(s0, { type: "objectives", live: new Set(["explore"]) })).toBe(s0);
  });
});

describe("the NEW MISSION blink on Mission (wave 47)", () => {
  it("reads NEW MISSION alone: the card under it already names the mission", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { TitleBar } = await import("../src/chrome/title-bar.tsx");
    const o = { id: "hunt", title: "The Truth Scavenger Hunt: find three facts", brief: "", checklist: [], buttons: [], act: null };
    const html = renderToStaticMarkup(createElement(TitleBar, { objectives: [o], fallback: "x", onOpen: () => {}, act: "▣ MISSION", flash: { id: "hunt", title: o.title, brief: "NEW MISSION" } }));
    expect(html).toContain('<span class="title-bar-news" role="status">NEW MISSION</span>');
    expect(html).not.toContain("find three facts");
    const frame = readFileSync(new URL("../src/guest/frame.tsx", import.meta.url), "utf8");
    expect(frame).toContain('{ id: mission.id, title: mission.title, brief: "NEW MISSION" }');
  });
});
