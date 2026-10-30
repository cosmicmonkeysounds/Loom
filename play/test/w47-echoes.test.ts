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
