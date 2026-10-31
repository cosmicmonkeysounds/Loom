// Wave 59: a printed text code does what its QR does. `printedHit` over the
// real show and the real runtime: each kind typed clean and typed badly comes
// back as its QR's link, a room's or a sign's never reaches the Codex, and a
// true miss still fires the story's `wrong code`. Every code here is read from
// the server's own answers, so none is ever written down, and every assertion
// is on a kind or a boolean: a failure never prints a code.

import { afterAll, describe, expect, it } from "vitest";
import { scenarioFactsFile, scenarioSource } from "../examples/load.ts";
import { EventRegistry } from "../server/registry.ts";
import { checkinSlug, roomCode, signCode } from "../server/routes/k12.ts";
import { printedHit, type PrintedSource } from "../server/routes/printed.ts";
import { partCode } from "../server/routes/rejoin.ts";
import { resolveGoWord } from "../src/go.ts";
import { compileFromSource, inWorldLabel } from "../src/runtime/sim/index.ts";
import { CODES, booth, call, cleanup, freshDir, mod, post, runtime } from "./w13-fix-harness.ts";

afterAll(cleanup);

const show = () => runtime({ scenarioSource: scenarioSource("trapped-in-the-internet"), facts: scenarioFactsFile("trapped-in-the-internet")?.source ?? null });
type Rt = ReturnType<typeof show>;

type Codes = {
  codex: { code: string; url: string }[];
  checkin: { id: string; code: string; url: string; label: string; place: string | null }[];
  actions: { code: string; url: string }[];
  claims: { character: string; code: string; url: string }[];
  castLinks: { character: string; code: string; url: string }[];
};
const codesOf = async (rt: Rt): Promise<Codes> => (await mod(rt, "/api/mod/codes")).json as unknown as Codes;
const blank = async (rt: Rt) => ((await mod(rt, "/api/mod/badges", { from: 1, count: 1 })).json.badges as { code: string; url: string }[])[0]!;

const SPACED = (code: string) => code.toLowerCase().replace(/-/gu, " ");
const BARE = (code: string) => code.replace(/-/gu, "");

async function guest(rt: Rt, name: string): Promise<string> {
  await mod(rt, "/api/mod/start");
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  return r.json.token as string;
}
const ask = async (rt: Rt, token: string, code: string) => post(rt, "/api/guest/printed", { code, token });

describe("in-world names", () => {
  it("drops the crew's note and keeps the name", () => {
    expect(inWorldLabel("The Start Bar (kitchen)")).toBe("The Start Bar");
    expect(inWorldLabel("The Optical Drive (mud room) — Login")).toBe("The Optical Drive");
    expect(inWorldLabel("The Internet (Reinstallation — backyard)")).toBe("The Internet");
    expect(inWorldLabel("The Cloud (backyard — Truth Pong)")).toBe("The Cloud");
    expect(inWorldLabel("The Script")).toBe("The Script");
    expect(inWorldLabel("(kitchen)")).toBe("(kitchen)");
  });

  it("every room a guest can read is in-world, and the crew keep the whole label", async () => {
    const rt = show();
    const token = await guest(rt, "Ada");
    const sim = rt["sim"] as unknown as { channelHead(id: string): { title: string }; model: { locations: Map<string, { id: string }> } };
    for (const l of sim.model.locations.values()) expect(sim.channelHead(`loc:${l.id}`).title).not.toMatch(/\(|—/u);
    const seen = await call(rt, "GET", `/api/state?role=guest&token=${token}`);
    expect(JSON.stringify(seen.json)).not.toMatch(/\((kitchen|office|game room|studio|laundry|bedroom 2|crawl space|cold storage|living room|mud room|bathrooms)\)/u);
    const crew = await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true });
    expect(JSON.stringify(crew.json)).toContain("(kitchen)");
  });
});

describe("in-world names past the screens", () => {
  const BRACKET = /[()]|—/u;

  it("Trabolta's facts and a Go button read the story's names, never the real rooms", async () => {
    const rt = show();
    await guest(rt, "Ada");
    const facts = (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json as unknown as { locations: { label: string }[] };
    expect(facts.locations.length).toBeGreaterThan(0);
    for (const l of facts.locations) expect(l.label).not.toMatch(BRACKET);
    const model = compileFromSource(scenarioSource("trapped-in-the-internet"));
    for (const id of model.locations.keys()) {
      const go = resolveGoWord(model as unknown as Parameters<typeof resolveGoWord>[0], id);
      expect(go?.label ?? "", id).not.toMatch(BRACKET);
    }
  });
});

describe("a typed code finds its QR's link", () => {
  it("each kind, typed clean, in lower case, with spaces, without its hyphen", async () => {
    const rt = show();
    await mod(rt, "/api/mod/start");
    const c = await codesOf(rt);
    const b = await blank(rt);
    const cases: Array<[string, string, string]> = [
      ["room", c.checkin[0]!.code, c.checkin[0]!.url],
      ["sign", c.actions[0]!.code, c.actions[0]!.url],
      ["badge", b.code, b.url],
      ["invited", c.claims[0]!.code, c.claims[0]!.url],
      ["staff", c.castLinks[0]!.code, c.castLinks[0]!.url],
    ];
    for (const [kind, code, url] of cases) {
      for (const typed of [code, code.toLowerCase(), SPACED(code), BARE(code), `  ${code} `]) {
        const hit = rt.printedHit(typed);
        expect(hit?.kind === kind && hit.url === url, kind).toBe(true);
      }
    }
    // A staff badge's link is what the QR on the sheet carries: the guest code.
    expect(rt.printedHit(c.castLinks[0]!.code)?.url.includes(`code=${CODES.event}`)).toBe(true);
    expect(rt.printedHit(CODES.event)?.kind).toBe("join");
  });

  it("forgives what a printed code can't hold, and a room code without its R-", async () => {
    const rt = show();
    await mod(rt, "/api/mod/start");
    const c = await codesOf(rt);
    const room = c.checkin[0]!;
    const bare = room.code.slice(2);
    expect(rt.printedHit(bare)?.url === room.url).toBe(true);
    expect(rt.printedHit(room.code.replace(/0/gu, "O").replace(/1/gu, "I"))?.url === room.url).toBe(true);
    const b = await blank(rt);
    expect(rt.printedHit(b.code.replace(/0/gu, "o").replace(/1/gu, "l"))?.kind).toBe("badge");
  });

  it("a room's name finds it, and a room with no sign says so at the check-in, never as a miss", async () => {
    const rt = show();
    await mod(rt, "/api/mod/start");
    expect(rt.printedHit("the start bar")?.url.endsWith(`checkin=${checkinSlug("The Start Bar")}`)).toBe(true);
    expect(rt.printedHit("START BAR")?.kind).toBe("room");
    expect(rt.printedHit("the-server-room")?.kind).toBe("room");
    expect(rt.printedHit("nowhere at all")).toBeNull();
  });

  it("a codex code is the Codex's: asked here it is nothing, so this tells a phone nothing", async () => {
    const rt = show();
    await mod(rt, "/api/mod/start");
    const c = await codesOf(rt);
    expect(c.codex.every((e) => rt.printedHit(e.code) === null)).toBe(true);
    expect(c.codex.every((e) => rt.printedHit(SPACED(e.code)) === null)).toBe(true);
  });

  it("no room, sign or badge code is also a codex code, and rooms and signs are told apart", async () => {
    const rt = show();
    await mod(rt, "/api/mod/start");
    const c = await codesOf(rt);
    const fold = (s: string) => s.toLowerCase().replace(/[\s_-]+/gu, "");
    const codex = new Set(c.codex.map((e) => fold(e.code)));
    const printed = [...c.checkin, ...c.actions, ...c.claims, ...c.castLinks].map((p) => fold(p.code));
    expect(printed.some((p) => codex.has(p))).toBe(false);
    expect(new Set(printed).size).toBe(printed.length);
    expect(new Set(c.codex.map((e) => fold(e.code))).size).toBe(c.codex.length);
  });
});

describe("the Scan sheets' route", () => {
  it("answers a guest with the link, a miss with null, and only that", async () => {
    const rt = show();
    const token = await guest(rt, "Ada");
    const c = await codesOf(rt);
    const hit = await ask(rt, token, c.checkin[0]!.code);
    expect(hit.status).toBe(200);
    expect((hit.json.hit as { kind: string }).kind).toBe("room");
    expect((await ask(rt, token, "not-a-code")).json.hit).toBeNull();
    expect((await post(rt, "/api/guest/printed", { code: "x" })).status).toBe(401);
  });

  it("a booth asks too; no token, no answer", async () => {
    const rt = show();
    await mod(rt, "/api/mod/start");
    const c = await codesOf(rt);
    const token = (await booth(rt, "Clippy")).json.token as string;
    const hit = await post(rt, "/api/prime/printed", { code: c.checkin[0]!.code, token });
    expect(hit.status).toBe(200);
    expect((hit.json.hit as { kind: string }).kind).toBe("room");
    expect((await post(rt, "/api/prime/printed", { code: "x" })).status).toBe(403);
  });

  it("stops a phone that keeps guessing (wrong answers only), and a wall of text is no question", async () => {
    const rt = runtime({ scenarioSource: scenarioSource("trapped-in-the-internet"), limits: { printedAsks: { max: 2, windowMs: 60_000 } } });
    const token = await guest(rt, "Ada");
    const c = await codesOf(rt);
    await ask(rt, token, "nope-one");
    await ask(rt, token, "nope-two");
    expect((await ask(rt, token, "nope-three")).status).toBe(429);
    expect((await ask(rt, token, "x".repeat(200))).json.hit).toBeNull();
    expect(c.checkin.length).toBeGreaterThan(0);
  });

  it("a room's code costs nothing, and a true miss is still the story's `wrong code`", async () => {
    const rt = show();
    const token = await guest(rt, "Ada");
    const doubt = () => (rt["sim"] as unknown as { world: { get(k: string): unknown }; persons: Map<string, unknown> }).world.get(`${[...(rt["sim"] as unknown as { persons: Map<string, unknown> }).persons.keys()][0]}.doubt`);
    const before = doubt();
    const c = await codesOf(rt);
    await ask(rt, token, c.checkin[0]!.code);
    expect(doubt()).toBe(before);
    const miss = await post(rt, "/api/guest/codex/redeem", { code: "not-a-real-code", token });
    expect(miss.json.missed).toBe(true);
    expect(Number(doubt() ?? 0)).toBe(Number(before ?? 0) + 8);
  });
});

describe("what the Codex must not charge for", () => {
  const person = (rt: Rt) => [...(rt["sim"] as unknown as { persons: Map<string, unknown> }).persons.keys()][0]!;
  const doubtOf = (rt: Rt) => Number((rt["sim"] as unknown as { world: { get(k: string): unknown } }).world.get(`${person(rt)}.doubt`) ?? 0);
  const redeem = (rt: Rt, token: string, code: string, extra: Record<string, unknown> = {}) => post(rt, "/api/guest/codex/redeem", { code, token, ...extra });

  it("a printed code reaching the redeem route, as a terminal's box sends it, is no wrong code", async () => {
    const rt = show();
    const token = await guest(rt, "Ada");
    const c = await codesOf(rt);
    const b = await blank(rt);
    const before = doubtOf(rt);
    for (const [kind, code] of [["room", c.checkin[0]!.code], ["sign", c.actions[0]!.code], ["badge", b.code], ["invited", c.claims[0]!.code], ["staff", c.castLinks[0]!.code]] as const) {
      const r = await redeem(rt, token, code);
      expect(r.status, kind).toBe(200);
      expect(r.json.missed, kind).toBeUndefined();
      expect(r.json.printed, kind).toBe(kind);
      expect(r.json.unlocked, kind).toBeNull();
    }
    expect(doubtOf(rt)).toBe(before);
  });

  it("words from the Scan sheet's box cost nothing and fire nothing, but count against the throttle", async () => {
    const rt = runtime({ scenarioSource: scenarioSource("trapped-in-the-internet"), facts: scenarioFactsFile("trapped-in-the-internet")?.source ?? null, limits: { redeemMisses: { max: 2, windowMs: 60_000 } } });
    const token = await guest(rt, "Ada");
    const before = doubtOf(rt);
    const a = await redeem(rt, token, "hello there friend", { spaced: true });
    expect(a.json.missed).toBeUndefined();
    expect(a.json.words).toBe(true);
    expect(doubtOf(rt)).toBe(before);
    expect((await redeem(rt, token, "living room", { spaced: true })).json.words).toBe(true);
    expect((await redeem(rt, token, "third try here", { spaced: true })).status).toBe(429);
    expect(doubtOf(rt)).toBe(before);
  });

  it("a real code typed with spaces still unlocks; the same words anywhere else are still a miss", async () => {
    const rt = show();
    const token = await guest(rt, "Ada");
    const c = await codesOf(rt);
    const entry = c.codex[0]!;
    const hit = await redeem(rt, token, SPACED(`${entry.code.slice(0, 2)}-${entry.code.slice(2)}`), { spaced: true });
    expect(hit.json.unlocked === null || typeof hit.json.unlocked === "string").toBe(true);
    expect(hit.json.words).toBeUndefined();
    expect(typeof hit.json.unlocked).toBe("string");
    const before = doubtOf(rt);
    const miss = await redeem(rt, token, "hello there friend");
    expect(miss.json.missed).toBe(true);
    expect(doubtOf(rt)).toBe(before + 8);
    // No space in it, the flag means nothing: a true miss is a true miss.
    expect((await redeem(rt, token, "not-a-real-code", { spaced: true })).json.missed).toBe(true);
  });
});

describe("the join screen's resolve", () => {
  const registry = () => {
    const reg = new EventRegistry(freshDir(), () => "http://localhost");
    return { reg, rt: reg.register(show()) };
  };

  it("takes a badge's code, an invited one and a staff one, and hands back the QR's path", async () => {
    const { reg, rt } = registry();
    const c = await codesOf(rt);
    const b = await blank(rt);
    for (const [code, want] of [
      [b.code, b.url],
      [SPACED(c.claims[0]!.code), c.claims[0]!.url],
      [BARE(c.castLinks[0]!.code), c.castLinks[0]!.url],
    ] as const) {
      const hit = reg.resolveCode(code);
      expect(hit?.role).toBe("guest");
      expect(hit?.eventId).toBe("evt");
      expect(want.endsWith(hit?.printed ?? "no")).toBe(true);
    }
  });

  it("never hands the guest code to a room's code or name", async () => {
    const { reg, rt } = registry();
    const c = await codesOf(rt);
    expect(reg.resolveCode(c.checkin[0]!.code)).toBeNull();
    expect(reg.resolveCode(c.actions[0]!.code)).toBeNull();
    expect(reg.resolveCode("the desktop")).toBeNull();
  });

  it("the real passcodes still win", () => {
    const { reg } = registry();
    expect(reg.resolveCode(CODES.event)?.printed).toBeUndefined();
    expect(reg.resolveCode(CODES.mod)?.role).toBe("mod");
  });
});

describe("what a code is made of", () => {
  const model = compileFromSource(scenarioSource("trapped-in-the-internet"));
  const src = (secret: string): PrintedSource => ({ secret, base: "https://a", guestCode: "E", model, parts: ["Clippy"], badgeNumber: () => null, invited: () => [] });

  it("is the secret and the folded name: the same night after night, new with a new secret", () => {
    expect(roomCode("s", "The Start Bar")).toBe(roomCode("s", "the  start bar"));
    expect(roomCode("s", "The Start Bar")).not.toBe(roomCode("t", "The Start Bar"));
    expect(roomCode("s", "Bathroom")).not.toBe(signCode("s", "Bathroom").replace("S-", "R-"));
    expect(printedHit(partCode("s", "Clippy"), src("s"))?.kind).toBe("staff");
    expect(printedHit(partCode("s", "Clippy"), src("t"))).toBeNull();
  });
});
