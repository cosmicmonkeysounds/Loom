// The play app's help collection: role gating + content integrity.

import { describe, expect, it } from "vitest";
import { articlesFor } from "../src/help.tsx";
import { searchHelp } from "../../docs/help/helpdoc.ts";

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
});
