//! Wave 14 — `GET /api/mod/cards` (the `/cards` page's data) and the page
//! itself: directors only (never a host booth), every room check-in and
//! codex fact with a server-drawn QR, the same links `/api/mod/codes` lists.

import { afterAll, describe, expect, it } from "vitest";
import { scenarioFactsFile, scenarioSource } from "../examples/load.ts";
import { CARDS_HTML, CARDS_JS, serveCardsPage } from "../server/cards-page.ts";
import { NOT_FROM_A_BOOTH } from "../server/routes/host.ts";
import { CODES, booth, call, cleanup, mod, post, runtime } from "./w13-fix-harness.ts";

afterAll(cleanup);

type Section = { kind: string; label: string; items: { ref: string; title: string; code?: string; url: string; svg: string; stack?: string; secret?: boolean }[] };

describe("GET /api/mod/cards", () => {
  it("is for moderators only: 401 without a token, 403 for an unknown token, 403 for a host booth", async () => {
    const rt = runtime();
    expect((await call(rt, "GET", "/api/mod/cards")).status).toBe(401);
    expect((await call(rt, "GET", "/api/mod/cards?token=nope")).status).toBe(403);
    const host = (await booth(rt, "Task Manager")).json.token as string;
    const r = await call(rt, "GET", `/api/mod/cards?token=${host}`);
    expect([r.status, r.json.error]).toEqual([403, NOT_FROM_A_BOOTH]);
    const plain = (await booth(rt, "Norton")).json.token as string;
    expect((await call(rt, "GET", `/api/mod/cards?token=${plain}`)).status).toBe(403);
  });

  it("a mod token reads the show's rooms and facts, each with an SVG QR of the codes route's link", async () => {
    const rt = runtime({ scenarioSource: scenarioSource("trapped-in-the-internet"), facts: scenarioFactsFile("trapped-in-the-internet")?.source ?? null });
    const login = await post(rt, "/api/mod/login", { passcode: CODES.mod });
    const token = login.json.token as string;
    const r = await call(rt, "GET", `/api/mod/cards?token=${token}`);
    expect(r.status).toBe(200);
    expect(r.json.eventPass).toBe(CODES.event);
    const sections = r.json.sections as Section[];
    expect(sections.map((s) => s.kind).slice(0, 3)).toEqual(["rooms", "facts", "join"]);
    const rooms = sections[0]!.items;
    const desktop = rooms.find((i) => i.url.endsWith("checkin=the-desktop"));
    expect(desktop?.svg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/u);
    expect(rooms.some((i) => i.url.includes("checkin=the-server-room"))).toBe(false); // checkin: false
    const facts = sections[1]!.items;
    expect(facts.length).toBeGreaterThan(40); // before the doors too
    await mod(rt, "/api/mod/start");
    const codes = await mod(rt, "/api/mod/codes");
    const codex = codes.json.codex as { id: string; url: string; code: string }[];
    expect(codex.length).toBeGreaterThan(40);
    expect(facts.length).toBe(codex.length);
    expect(new Set(facts.map((f) => f.url))).toEqual(new Set(codex.map((c) => c.url)));
    expect(facts.every((f) => f.svg.startsWith("<svg"))).toBe(true);
    // Stacked from the facts file: the hunt answers lead, secrets marked.
    expect(facts[0]!.stack).toBe("hunt answers");
    expect(facts.some((f) => f.secret === true)).toBe(true);
    // A digit note shows title + QR only.
    const digit = facts.find((f) => f.stack === "the cold door's digits");
    if (digit !== undefined) expect(digit.code).toBeUndefined();
    expect(sections[2]!.items[0]!.url).toBe(`http://localhost/?code=${CODES.event}`);
  });

  it("the author session (moderator) reads it too", async () => {
    const rt = runtime();
    const r = await call(rt, "GET", "/api/mod/cards", {}, { moderator: true });
    expect(r.status).toBe(200);
    expect((r.json.sections as Section[])[0]!.items.map((i) => i.title)).toEqual(["Hall"]);
  });
});

describe("the /cards page", () => {
  const res = () => {
    const out = { status: 0, headers: {} as Record<string, string>, body: "" };
    return {
      out,
      writeHead(s: number, h: Record<string, string>) {
        out.status = s;
        out.headers = h;
      },
      end(b?: string) {
        out.body = b ?? "";
      },
    };
  };
  it("serves the page and its script, no inline script, no secrets", () => {
    for (const p of ["/cards", "/cards/"]) {
      const r = res();
      expect(serveCardsPage("GET", p, r as never, "script-src 'self'")).toBe(true);
      expect(r.out.status).toBe(200);
      expect(r.out.headers["content-security-policy"]).toBe("script-src 'self'");
      expect(r.out.body).toContain('<script src="/cards.js"></script>');
    }
    expect(CARDS_HTML).not.toMatch(/<script>(?!<\/script>)/u);
    const js = res();
    expect(serveCardsPage("GET", "/cards.js", js as never, "")).toBe(true);
    expect(js.out.body).toBe(CARDS_JS);
    expect(CARDS_JS).toContain("/api/mod/cards");
    expect(serveCardsPage("GET", "/cardsx", res() as never, "")).toBe(false);
    expect(serveCardsPage("POST", "/cards", res() as never, "")).toBe(false);
    // The script parses.
    expect(() => new Function(CARDS_JS)).not.toThrow();
  });
});
