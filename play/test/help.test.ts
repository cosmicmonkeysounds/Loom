// The play app's help collection: role gating + content integrity.

import { describe, expect, it } from "vitest";
import { articlesFor } from "../src/help.tsx";
import { inlineTokens, searchHelp, type HelpArticle } from "../../docs/help/helpdoc.ts";

/** Everything a guest can read of an article: title, keywords and body. */
function readable(a: HelpArticle): string {
  return [a.title, a.keywords.join(", "), a.plain].join("\n");
}

/** The in-fiction names that contain a banned word, stripped before the
 *  check (wave 26 G2): the Server Room and Server Door terminals, and the
 *  app's own labels for the guests' clubs, which it calls crews (*＋ Found a
 *  crew*, *Leave the crew*, *Name your crew*, the ◇ crew badge, the crew
 *  room, *Sides & crews*). Exact labels only: guest prose about crews uses
 *  the plural, so "a crew member" or "in the crew" is still caught. */
const ALLOWED = [
  /server[ -]room/giu,
  /server door/giu,
  /sides (?:&|and) crews/giu,
  /\bfound a crew\b/giu,
  /\bleave the crew\b/giu,
  /\bname your crew\b/giu,
  /◇ your crew\b/giu,
  /\bcrew rooms?\b/giu,
  /\bcrew's room\b/giu,
];

function stripAllowed(text: string): string {
  return ALLOWED.reduce((t, re) => t.replace(re, " "), text);
}

/** G2: the machinery and the people who run it. Whole words, any case. */
const MACHINERY: Array<[string, RegExp]> = [
  ["director", /\bdirectors?\b/iu],
  ["crew", /\bcrew\b/iu],
  ["operator", /\boperators?\b/iu],
  ["performer", /\bperformers?\b/iu],
  ["costume", /\bcostumes?\b/iu],
  ["booth", /\bbooths?\b/iu],
  ["editor", /\beditors?\b/iu],
  ["Run mode", /\brun mode\b/iu],
  ["Run →", /\brun →/iu],
  ["moderator", /\bmoderators?\b/iu],
  ["passcode", /\bpasscodes?\b/iu],
  ["event server", /\bevent server\b/iu],
  ["the house's server", /\bthe house's server\b/iu],
  ["the server", /\bthe server\b/iu],
  ["server", /\bservers?\b/iu],
  ["staff", /\bstaff\b/iu],
  ["cast", /\bcast\b/iu],
  ["rehearsal", /\brehears(?:al|e)\b/iu],
  ["kiosk", /\bkiosk\b/iu],
  ["sensor", /\bsensors?\b/iu],
  ["provisioning", /\bprovision/iu],
  ["mod code", /\bmod codes?\b/iu],
  ["a provisioning link", /[?&](?:code|spot|view|announce)=/iu],
  ["Loom", /\bloom\b/iu],
  ["stagehand", /\bstagehands?\b/iu],
  ["the crew by name", /\b(?:john|steph|jesse)\b/iu],
];

/** G1 / G2: hidden rules, later beats, endings, and the game's secrets (R4
 *  the void, R6 the heart, R7 the virus pickup). */
const SPOILERS: Array<[string, RegExp]> = [
  ["the door code", /\bdoor code\b/iu],
  ["the King's strength", /grandmaster|worse he plays|pawns only|nothing but his pawns/iu],
  ["the audit's rule", /every third transfer|auto-approves|nobody auditing/iu],
  ["who answers as a character", /whoever is playing|running the show|someone running/iu],
  ["the banished ending", /\bbanish|hand jive/iu],
  ["the party favour", /party favour|speedrun/iu],
  ["the end of the night", /human again|show is over/iu],
  ["the judging rule", /lie on the record|filed below 100|filed at 100/iu],
  ["what the story tracks", /tracks heat|story (?:may )?notices?|story is watching|noticed\* by the story/iu],
  ["later beats", /truther download|ad hijack|midnight|11:00 pm/iu],
  ["what marks a program", /named on the bingo card|a refused truth/iu],
  ["the void", /\bvoid\b|jump scare|teleport/iu],
  ["the heart", /\bheart\b/iu],
  ["the virus pickup", /\bfloppy\b|\bdisks?\b|\bpick(?:s|ed)? (?:it )?up\b|ILOVEYOU|free antivirus trial/iu],
];

function offences(rules: Array<[string, RegExp]>): string[] {
  const out: string[] = [];
  for (const a of articlesFor("guest")) {
    const text = stripAllowed(readable(a));
    for (const [name, re] of rules) {
      const m = re.exec(text);
      if (m) out.push(`${a.slug}: ${name} ("${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/gu, " ")}")`);
    }
  }
  return out;
}

describe("play help", () => {
  it("guests see the guest guide only; performers see everything", () => {
    const guest = articlesFor("guest");
    const prime = articlesFor("performer");
    expect(guest.length).toBeGreaterThanOrEqual(6);
    expect(guest.every((a) => !a.role || a.role === "guest")).toBe(true);
    expect(prime.length).toBeGreaterThan(guest.length);
    expect(prime.some((a) => a.slug === "performers")).toBe(true);
    expect(guest.some((a) => a.slug === "performers")).toBe(false);
  });

  it("every article is well-formed", () => {
    for (const a of articlesFor("performer")) {
      expect(a.title, a.slug).toBeTruthy();
      expect(a.blocks.length, a.slug).toBeGreaterThan(0);
      expect(a.keywords.length, a.slug).toBeGreaterThan(0);
    }
  });

  it("search finds what party guests actually ask", () => {
    const articles = articlesFor("guest");
    expect(searchHelp(articles, "event code")[0]?.article.slug).toBe("welcome");
    expect(searchHelp(articles, "invite")[0]?.article.slug).toBe("invites");
    expect(searchHelp(articles, "captured").map((h) => h.article.slug)).toContain("your-pass");
    expect(searchHelp(articles, "decision")[0]?.article.slug).toBe("decisions");
    expect(searchHelp(articles, "wallet")[0]?.article.slug).toBe("wallet");
    expect(searchHelp(articles, "restricted").map((h) => h.article.slug)).toContain("your-pass");
    const scan = searchHelp(articlesFor("performer"), "scanner");
    expect(scan[0]?.article.slug).toBe("performers");
    expect(searchHelp(articlesFor("performer"), "approve")[0]?.article.slug).toBe("performers");
  });

  it("the performers guide says which alerts banner a booth (B1)", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../../docs/help/play/07-performers.md", import.meta.url), "utf8").replace(/\s+/gu, " ");
    expect(text).not.toMatch(/banner for every \*\*alert\*\*/u);
    expect(text).toContain("to everyone, to your character, or into a staff room");
    expect(text).toContain("doesn't banner your booth");
  });

  it("wave 25: the hosts' guide covers Show, the slim bar, the Desk and walking the checks", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../../docs/help/play/14-hosts.md", import.meta.url), "utf8").replace(/\s+/gu, " ");
    for (const h of ["## The Show window", "## The NEXT bar", "## The Desk", "### Walking the checks"]) expect(text).toContain(h);
    expect(text).toContain("Show · Chats · Desk · 📷 Scan");
    expect(text).toContain("Standby moved — press GO again");
    expect(text).not.toMatch(/pull up the console|five tabs/u);
    const prime = articlesFor("performer");
    for (const q of ["standby", "test tone", "show window", "house desk"]) expect(searchHelp(prime, q)[0]?.article.slug, q).toBe("hosts");
  });
});

describe("wave 26 G2: the guest guide never explains the machinery", () => {
  it("the guest guide never names the crew or the machinery", () => {
    expect(offences(MACHINERY)).toEqual([]);
  });

  it("the guest guide never explains a hidden rule, spoils a later beat, or mentions the void, the heart or the virus pickup", () => {
    expect(offences(SPOILERS)).toEqual([]);
  });

  it("the allowlist keeps the in-fiction names and nothing else", () => {
    expect(stripAllowed("the Server Room terminal, the server-room door and the Server Door")).not.toMatch(/server/iu);
    expect(stripAllowed("＋ Found a crew, Leave the crew, your crew's room, ⊞ Start → Sides & crews")).not.toMatch(/\bcrew\b/iu);
    expect(stripAllowed("the crew checking which tablet is which")).toMatch(/\bcrew\b/iu);
    for (const leak of ["ask a crew member", "someone in the crew will help", "your crew of hosts", "that crew", "one crew at a time"]) {
      expect(stripAllowed(leak), leak).toMatch(/\bcrew\b/iu);
    }
    expect(stripAllowed("◇ your crew, Name your crew")).not.toMatch(/\bcrew\b/iu);
    expect(MACHINERY.find(([n]) => n === "stagehand")![1].test("a crew of stagehands runs the night")).toBe(true);
    expect(stripAllowed("after the house's server restarts")).toMatch(/\bserver\b/iu);
    // The guest guide still names the two in-fiction terminals.
    const guest = articlesFor("guest").map(readable).join("\n");
    expect(guest).toMatch(/server room/iu);
    expect(guest).toMatch(/server door/iu);
  });

  it("the cut material is in a performer-only article, and the crew setup is gone from the play help", () => {
    const guest = articlesFor("guest");
    const prime = articlesFor("performer");
    const staff = prime.find((a) => a.slug === "house-workings");
    expect(staff?.role).toBe("performer");
    expect(guest.some((a) => a.slug === "house-workings")).toBe(false);
    for (const q of ["king", "audit", "banished", "party favour", "heart", "locked"]) {
      expect(searchHelp([staff!], q).length, q).toBe(1);
    }
    // The terminal and headset provisioning moved to the authoring help
    // (docs/help/authoring/48-terminal-setup.md): no play article carries it.
    for (const a of prime) expect(a.plain, a.slug).not.toMatch(/\/terminal\/\?code=|calibrate: door|set up this headset/iu);
  });

  it("the reinstallation copy follows the games (C12) and the locked phone (R1)", () => {
    const guest = articlesFor("guest").map(readable).join("\n");
    expect(guest).not.toMatch(/until the night is over, only a marked program may play/iu);
    expect(guest).not.toMatch(/held by a director/iu);
    expect(guest).not.toMatch(/go to the internet\*\*|📍 go to the internet/iu);
    expect(guest).not.toMatch(/follow the golden|chevrons/iu);
    expect(guest).not.toMatch(/🎤 live|🎤 muted/iu);
    const pass = articlesFor("guest").find((a) => a.slug === "your-pass")!;
    expect(pass.plain).toContain("show my pass");
    expect(pass.plain).toContain("bathroom mode");
    expect(searchHelp(articlesFor("guest"), "locked").map((h) => h.article.slug)).toContain("your-pass");
  });

  it("the confrontation offers only the pass and Bathroom Mode, never an OK (R1, C1)", () => {
    const lines = articlesFor("guest")
      .flatMap((a) => a.plain.split("\n"))
      .filter((l) => l.includes("virus detected"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(/→ ok\b/u);
    const notifications = articlesFor("guest").find((a) => a.slug === "notifications")!;
    const big = notifications.plain.split("\n").find((l) => l.startsWith("⚠ virus detected"));
    expect(big).toContain("show my pass");
    expect(big).toContain("bathroom mode");
    expect(big).toContain("no ok");
  });

  it("the guest guide still says private threads can be read (G2 keeps the disclosure)", () => {
    const codex = articlesFor("guest").find((a) => a.slug === "codex")!;
    expect(codex.plain).toContain("the computer can read every thread, this one included");
  });

  it("every cross-link resolves, and no guest article points at a performer-only one", () => {
    const all = new Map(articlesFor("performer").map((a) => [a.slug, a]));
    for (const a of all.values()) {
      for (const block of a.blocks) {
        const texts =
          block.kind === "para" || block.kind === "quote" || block.kind === "heading"
            ? [block.text]
            : block.kind === "list"
              ? block.items
              : block.kind === "table"
                ? [...block.header, ...block.rows.flat()]
                : [];
        for (const text of texts) {
          for (const tok of inlineTokens(text)) {
            if (tok.kind !== "link" || /^[a-z]+:\/\//u.test(tok.href)) continue;
            const target = all.get(tok.href);
            expect(target, `${a.slug} links to missing article "${tok.href}"`).toBeDefined();
            if (!a.role) expect(target?.role, `guest article ${a.slug} links to ${tok.href}`).toBeUndefined();
          }
        }
      }
    }
  });

  it("the guest guide still answers how to work the phone, the terminals and the game", () => {
    const guest = articlesFor("guest");
    const top = (q: string) => searchHelp(guest, q)[0]?.article.slug;
    expect(top("chess")).toBe("terminals");
    expect(top("casino")).toBe("terminals");
    expect(top("headset")).toBe("reinstallation");
    expect(top("gerald")).toBe("reinstallation");
    expect(searchHelp(guest, "bathroom").map((h) => h.article.slug)).toContain("your-pass");
    expect(searchHelp(guest, "disconnect")[0]?.article.slug).toBe("terminals");
    // The reserve's buttons are phone controls a featured program (a guest)
    // may hold, so the guest guide explains them.
    for (const q of ["stimulus", "grant", "freeze"]) expect(top(q), q).toBe("wallet");
  });
});
