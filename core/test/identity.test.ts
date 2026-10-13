//! Sign-in identities: who may be whom at the door.
//!
//! The story decides — a character with a part (hooks / beats / a body /
//! a mind) is a performer's, a bare name is a guest's program — and the
//! runtime enforces it: exclusive claims on both sides, no guest as an
//! Antivirus, any software from the directory (Wikipedia, faked here) with
//! its picture served same-origin.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { guestNameRefusal, guestPickable, identityDefs, performerPickable, performerRefusal } from "../server/identity.ts";
import { WikiClient, fileUrl, isAntivirusSoftware, pickFile, rankFiles, type WikiFetch } from "../server/wiki.ts";
import { AvatarBook, ImageCache, avatarKey, avatarRefUrl, type ImageFetch } from "../server/avatars.ts";

const SHOW = scenarioSource("trapped-in-the-internet");
const CODES = { event: "EVT900", prime: "PRM900", mod: "MOD900" };

// --- a fake Wikipedia ---------------------------------------------------------

interface FakeArticle {
  title: string;
  description: string;
  image?: string;
  /** Which infobox the article carries (which search catalogue finds it). */
  template: "Infobox software" | "Infobox video game" | "Infobox website";
}

const ARTICLES: FakeArticle[] = [
  { title: "NHL 97", description: "1996 video game", image: "https://img.test/nhl97.png", template: "Infobox video game" },
  { title: "NHL 98", description: "1997 video game", image: "https://img.test/nhl98.png", template: "Infobox video game" },
  { title: "Norton AntiVirus", description: "Anti-virus software", image: "https://img.test/nav.png", template: "Infobox software" },
  { title: "Norton Commander", description: "Discontinued orthodox file manager software", image: "https://img.test/nc.png", template: "Infobox software" },
  { title: "Microsoft Paint", description: "Raster graphics editor", image: "https://img.test/paint.png", template: "Infobox software" },
  { title: "Clippy", description: "Microsoft Office assistant", image: "https://img.test/clippy.png", template: "Infobox software" },
  { title: "Winamp", description: "Media player", template: "Infobox software" },
];
const REDIRECTS: Record<string, string> = { "MS Paint": "Microsoft Paint" };
/** Each article's files (+ the lead image Wikipedia registers, a screenshot). */
const GALLERIES: Record<string, { lead?: string; files: string[] }> = {
  Winamp: { files: ["File:Commons-logo.svg", "File:Winamp screenshot.png", "File:Winamp logo.png"] },
  "NHL 97": { lead: "NHL_97_gameplay.png", files: ["File:NHL 97 gameplay.png", "File:NHL 97 cover.jpg", "File:OOjs UI icon edit-ltr-progressive.svg", "File:Winamp glyph.png", "File:NHL 97 logo.svg"] },
};

function page(a: FakeArticle, index: number) {
  return {
    pageid: 1000 + ARTICLES.indexOf(a),
    title: a.title,
    index,
    description: a.description,
    ...(a.image !== undefined ? { thumbnail: { source: a.image, width: 256, height: 256 } } : {}),
  };
}

/** Answers the two query shapes `WikiClient` sends. Records every URL. */
function fakeWiki(): { fetch: WikiFetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: WikiFetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const p = u.searchParams;
    let pages: unknown[] = [];
    if (p.get("generator") === "search") {
      const raw = p.get("gsrsearch") ?? "";
      const m = /^(.*) hastemplate:"([^"]+)"$/u.exec(raw);
      const q = (m?.[1] ?? raw).toLowerCase();
      const template = m?.[2];
      const words = q.split(" ").filter(Boolean);
      const matches = (a: FakeArticle) => words.some((w) => a.title.toLowerCase().includes(w));
      pages = ARTICLES.filter((a) => (template === undefined || a.template === template) && matches(a)).map((a, i) => page(a, i + 1));
    } else if (p.get("prop") === "pageimages|images") {
      const title = p.get("titles")!;
      const g = GALLERIES[title];
      pages = [{ pageid: 1, title, ...(g?.lead !== undefined ? { pageimage: g.lead } : {}), images: (g?.files ?? []).map((t) => ({ title: t })) }];
    } else if (p.get("prop") === "imageinfo") {
      pages = p
        .get("titles")!
        .split("|")
        .map((t) => ({ title: t, imageinfo: [{ thumburl: `https://img.test/${encodeURIComponent(t)}`, mime: "image/png", ...(/glyph/u.test(t) ? { width: 16, height: 16 } : { width: 256, height: 256 }) }] }));
    } else if (p.get("titles") !== null) {
      const title = REDIRECTS[p.get("titles")!] ?? p.get("titles")!;
      const a = ARTICLES.find((x) => x.title.toLowerCase() === title.toLowerCase());
      pages = a === undefined ? [{ title, missing: true }] : [page(a, 1)];
    }
    return { ok: true, status: 200, json: async () => ({ query: { pages } }) };
  };
  return { fetch, calls };
}

function fakeImages(): { fetch: ImageFetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: ImageFetch = async (url) => {
    calls.push(url);
    const ok = url.startsWith("https://img.test/");
    return {
      ok,
      status: ok ? 200 : 404,
      headers: { get: (n: string) => (n === "content-type" ? "image/png" : null) },
      arrayBuffer: async () => new TextEncoder().encode(`PNG:${url}`).buffer as ArrayBuffer,
    };
  };
  return { fetch, calls };
}

// --- the runtime harness (matches server-security.test.ts) -----------------

const dirs: string[] = [];
function freshRuntime(opts: { wiki?: WikiClient | null; images?: ImageCache } = {}): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-identity-"));
  dirs.push(d);
  const rt = new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "trapped-in-the-internet",
    scenarioSource: SHOW,
    joinBase: () => "http://localhost",
    ...(opts.wiki !== undefined ? { wiki: opts.wiki } : {}),
    ...(opts.images !== undefined ? { images: opts.images } : {}),
  });
  rt.openDoors();
  return rt;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface FakeRes {
  statusCode: number;
  body: string;
  raw: Uint8Array | null;
  headers: Record<string, string>;
}
function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    socket: { remoteAddress: headers["x-test-ip"] ?? "1.2.3.4" },
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & FakeRes {
  const res = {
    statusCode: 0,
    body: "",
    raw: null as Uint8Array | null,
    headers: {} as Record<string, string>,
    headersSent: false,
    setHeader() {},
    writeHead(s: number, h?: Record<string, string>) {
      res.statusCode = s;
      if (h) res.headers = h;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string | Uint8Array) {
      if (typeof b === "string") res.body = b;
      else if (b !== undefined) res.raw = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & FakeRes;
}
async function post(rt: EventRuntime, path: string, body: unknown, token?: string, opts: { moderator?: boolean } = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body, token ? { "x-loom-token": token } : {}), res, "POST", path, url, opts);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function get(rt: EventRuntime, path: string, opts: { moderator?: boolean } = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, opts);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, raw: res.raw, headers: res.headers };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------

describe("the story classifies its characters", () => {
  const model = Sim.fromSources(SHOW).model;
  const defs = identityDefs(model);
  const byName = (n: string) => defs.find((d) => d.name === n)!;

  it("a character with a part (hooks / beats / a body) is special; a bare name is pool", () => {
    expect(byName("Clippy").kind).toBe("special");
    expect(byName("Norton Anti-Virus").kind).toBe("special");
    expect(byName("Broken Ask Jeeves").kind).toBe("special");
    expect(byName("Microsoft Excel").kind).toBe("special");
    expect(byName("Calculator").kind).toBe("pool");
    expect(byName("MS Paint").kind).toBe("pool");
  });

  it("guests pick from the pool; performers pick the parts; props and Trabolta are nobody's", () => {
    const guests = defs.filter(guestPickable).map((d) => d.name);
    const performers = defs.filter(performerPickable).map((d) => d.name);
    expect(guests).toContain("Calculator");
    expect(guests).toContain("Minesweeper");
    expect(guests).not.toContain("Clippy");
    expect(guests).not.toContain("Norton Anti-Virus");
    expect(performers).toEqual(expect.arrayContaining(["Clippy", "Norton Anti-Virus", "Broken Ask Jeeves", "Microsoft Excel", "Task Manager", "MalwareBytes"]));
    expect(performers).not.toContain("Calculator");
    // `playable: false` on the Prop trait; `mind: external` on Trabolta.
    expect(byName("The Uploader").playable).toBe(false);
    expect(performers).not.toContain("The Uploader");
    expect(performers).not.toContain("The Router");
    expect(byName("Trabolta").agent).toBe(true);
    expect(performers).not.toContain("Trabolta");
    expect(guests).not.toContain("Trabolta");
  });

  it("a character with lines in a beat has a part, hooks or not", () => {
    const src = `# T\nstart: A\n\nCHARACTER The Voice\n\nCHARACTER Paint\n\n== A\nThe Voice: Welcome.\n`;
    const d = identityDefs(Sim.fromSources(src).model);
    expect(d.find((x) => x.name === "The Voice")!.kind).toBe("special");
    expect(d.find((x) => x.name === "Paint")!.kind).toBe("pool");
  });

  it("a name in a `joinable: false` caste is never a guest's", () => {
    const src = `# T\nstart: A\n\nGROUP Antivirus\n  joinable: false\n\nCHARACTER Avast\n  faction: Antivirus\n\nCHARACTER Paint\n\n== A\nHi.\n`;
    const m = Sim.fromSources(src).model;
    const d = identityDefs(m);
    expect(d.find((x) => x.name === "Avast")!.caste).toBe(true);
    expect(d.filter(guestPickable).map((x) => x.name)).toEqual(["Paint"]);
    expect(guestNameRefusal(m, "Avast", new Set())).toMatch(/can't be Antivirus/u);
    expect(guestNameRefusal(m, "avast", new Set())).toMatch(/can't be Antivirus/u); // folded
    expect(guestNameRefusal(m, "Paint", new Set())).toBeNull();
    expect(guestNameRefusal(m, "Paint", new Set(["paint"]))).toMatch(/already here/u);
    expect(guestNameRefusal(m, "Anything Else", new Set())).toBeNull();
  });

  it("refuses a performer a program, an agent, a prop, or a held part", () => {
    expect(performerRefusal(model, "Calculator", new Set())).toMatch(/program for guests/u);
    expect(performerRefusal(model, "Trabolta", new Set())).toMatch(/voiced by an agent/u);
    expect(performerRefusal(model, "The Uploader", new Set())).toMatch(/not a part anyone plays/u);
    expect(performerRefusal(model, "Clippy", new Set(["clippy"]))).toMatch(/already taken/u);
    expect(performerRefusal(model, "Clippy", new Set())).toBeNull();
    expect(performerRefusal(model, "Nobody", new Set())).toBe("unknown character");
  });
});

describe("the program directory (Wikipedia, faked)", () => {
  it("searches the software catalogues, merges by rank, and flags antivirus", async () => {
    const w = fakeWiki();
    const wiki = new WikiClient({ fetch: w.fetch });
    const hits = await wiki.search("norton");
    expect(hits.map((h) => h.title)).toEqual(["Norton AntiVirus", "Norton Commander"]);
    expect(hits[0]!.image).toBe("https://img.test/nav.png");
    expect(isAntivirusSoftware(hits[0]!.title, hits[0]!.description)).toBe(true);
    expect(isAntivirusSoftware(hits[1]!.title, hits[1]!.description)).toBe(false);
    // one query per catalogue + the global ranking, memoised
    expect(w.calls.length).toBe(4);
    await wiki.search("Norton ");
    expect(w.calls.length).toBe(4);
    expect(await wiki.search("   ")).toEqual([]);
  });

  it("looks a name up by exact title (following redirects), else by search", async () => {
    const w = fakeWiki();
    const wiki = new WikiClient({ fetch: w.fetch });
    expect((await wiki.lookup("MS Paint"))?.title).toBe("Microsoft Paint");
    expect(await wiki.avatarFor("Clippy")).toBe("https://img.test/clippy.png");
    expect((await wiki.lookup("nhl"))?.title).toBe("NHL 97"); // no article "nhl" → best search hit
    expect(await wiki.lookup("Nothing Whatsoever")).toBeNull();
    expect((await wiki.lookup("Broken Ask Clippy"))?.title).toBe("Clippy"); // minus its first word
    // An article with no registered lead image: its best own file (the logo, not the screenshot, never the furniture).
    expect(await wiki.avatarFor("Winamp")).toBe("https://img.test/File%3AWinamp%20logo.png");
    expect(await wiki.avatarFor("Nothing Whatsoever")).toBeNull();
  });

  it("picks an article's own picture: named after it, a logo over a screenshot, no furniture", () => {
    expect(pickFile("RuneScape", ["File:Commons-logo.svg", "File:General-Runescape-HUD.PNG", "File:OOjs UI icon edit-ltr-progressive.svg", "File:Runescape 3 Logo.png", "File:WPVG icon 2016.svg"])).toBe("File:Runescape 3 Logo.png");
    expect(pickFile("Norton AntiVirus", ["File:Antivirus.JPG"])).toBe("File:Antivirus.JPG");
    expect(pickFile("Control-Alt-Delete", [])).toBeNull();
    expect(pickFile("X", ["File:Commons-logo.svg", "File:Flag of Canada.svg", "File:Thing.pdf"])).toBeNull();
  });

  it("survives a dead endpoint", async () => {
    const wiki = new WikiClient({
      fetch: async () => {
        throw new Error("offline");
      },
    });
    expect(await wiki.search("anything")).toEqual([]);
    expect(await wiki.lookup("anything")).toBeNull();
  });
});

describe("the avatar book + image cache", () => {
  it("keys are opaque hashes of the URL; subjects fold like names", () => {
    const book = new AvatarBook();
    const key = book.assign("MS Paint", "https://img.test/paint.png");
    expect(key).toBe(avatarKey("https://img.test/paint.png"));
    expect(key).toMatch(/^[0-9a-f]{16}$/u);
    expect(book.keyFor("ms_paint")).toBe(key);
    expect(book.urlFor(key)).toBe("https://img.test/paint.png");
    expect(book.urlFor("0000000000000000")).toBeNull();
    expect(book.keys()).toEqual({ "ms paint": key });
    const copy = new AvatarBook();
    copy.load(book.entries());
    expect(copy.keyFor("MS Paint")).toBe(key);
  });

  it("caches picture bytes (LRU by size) and refuses non-images", async () => {
    const f = fakeImages();
    const cache = new ImageCache({ fetch: f.fetch, maxBytes: 60 });
    const a = await cache.get("https://img.test/a.png");
    expect(a?.contentType).toBe("image/png");
    expect(new TextDecoder().decode(a!.bytes)).toBe("PNG:https://img.test/a.png");
    await cache.get("https://img.test/a.png");
    expect(f.calls.length).toBe(1);
    await cache.get("https://img.test/b.png");
    await cache.get("https://img.test/c.png");
    expect(cache.count).toBeLessThan(3); // evicted under the byte cap
    expect(await cache.get("https://elsewhere.test/x.png")).toBeNull();
    expect(await cache.get("ftp://img.test/x.png")).toBeNull();
  });
});

describe("the join screens' pickers", () => {
  it("the event code lists the unclaimed pool with pictures; the performer code lists the parts", async () => {
    const w = fakeWiki();
    const rt = freshRuntime({ wiki: new WikiClient({ fetch: w.fetch }) });
    await tick(); // the doors-open lookups land
    const guests = await post(rt, "/api/identities", { passcode: CODES.event });
    expect(guests.status).toBe(200);
    expect(guests.json.role).toBe("guest");
    expect(guests.json.search).toBe(true);
    const names = guests.json.identities.map((r: { name: string }) => r.name);
    expect(names).toContain("MS Paint");
    expect(names).not.toContain("Clippy");
    expect(names).not.toContain("Norton Anti-Virus");
    const paint = guests.json.identities.find((r: { name: string }) => r.name === "MS Paint");
    expect(paint.avatar).toBe(avatarKey(fileUrl("File:Microsoft Paint.svg"))); // hand-picked in the show
    expect(paint.claimed).toBe(false);
    // Every named character in the show is hand-picked: nothing to look up.
    expect(w.calls.length).toBe(0);

    const parts = await post(rt, "/api/identities", { passcode: CODES.prime });
    expect(parts.json.role).toBe("prime");
    const partNames = parts.json.identities.map((r: { name: string }) => r.name);
    expect(partNames).toContain("Clippy");
    expect(partNames).not.toContain("Trabolta");
    expect(partNames).not.toContain("The Uploader");
    expect(partNames).not.toContain("MS Paint");
    expect(parts.json.identities.find((r: { name: string }) => r.name === "Clippy").avatar).toBe(avatarKey(fileUrl("File:Windows 11 Clippy paperclip emoji.png")));
    expect((await post(rt, "/api/identities", { passcode: "nope" })).status).toBe(403);
  });

  it("without a directory there is no search, and the hand-picked pictures still show", async () => {
    const rt = freshRuntime();
    const guests = await post(rt, "/api/identities", { passcode: CODES.event });
    expect(guests.json.search).toBe(false);
    expect(guests.json.identities.length).toBeGreaterThan(20);
    expect(guests.json.identities.every((r: { avatar: string | null }) => r.avatar !== null)).toBe(true);
    const parts = await post(rt, "/api/identities", { passcode: CODES.prime });
    expect(parts.json.identities.every((r: { avatar: string | null }) => r.avatar !== null)).toBe(true);
    expect((await post(rt, "/api/identities/search", { passcode: CODES.event, q: "nhl" })).status).toBe(503);
  });

  it("an authored `avatar:` link wins over the directory", async () => {
    const src = `# T\nstart: A\n\nCHARACTER Clippy\n  listed: true\n  avatar: https://img.test/custom-clippy.png\n\n== A\nHi.\n`;
    const d = mkdtempSync(join(tmpdir(), "loom-identity-"));
    dirs.push(d);
    const w = fakeWiki();
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "t", scenarioSource: src, joinBase: () => "http://x", wiki: new WikiClient({ fetch: w.fetch }) });
    rt.openDoors();
    await tick();
    const parts = await post(rt, "/api/identities", { passcode: CODES.prime });
    expect(parts.json.identities[0].avatar).toBe(avatarKey("https://img.test/custom-clippy.png"));
    expect(w.calls.length).toBe(0); // nothing to look up
  });

  it("never runs more than `concurrency` requests at once, and forgets a failed lookup", async () => {
    let inflight = 0;
    let peak = 0;
    let fail = true;
    const wiki = new WikiClient({
      concurrency: 2,
      fetch: async (url) => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 2));
        inflight--;
        if (fail) return { ok: false, status: 429, json: async () => ({}) };
        return fakeWiki().fetch(url, { headers: {} });
      },
    });
    expect(await Promise.all(["Clippy", "NHL 97", "Winamp", "Napster"].map((n) => wiki.lookup(n)))).toEqual([null, null, null, null]);
    expect(peak).toBe(2);
    fail = false; // the throttle lifts: the same names now resolve (nothing was memoised)
    expect((await wiki.lookup("Clippy"))?.title).toBe("Clippy");
  });
});

describe("guests: exclusive programs, any software, never antivirus", () => {
  it("a pool program is one guest's; a part or an Antivirus is refused", async () => {
    const rt = freshRuntime();
    const a = await post(rt, "/api/guest/register", { name: "Minesweeper", passcode: CODES.event });
    expect(a.status).toBe(200);
    const b = await post(rt, "/api/guest/register", { name: "minesweeper", passcode: CODES.event });
    expect(b.status).toBe(409);
    expect(b.json.error).toMatch(/already here/u);
    const list = await post(rt, "/api/identities", { passcode: CODES.event });
    expect(list.json.identities.find((r: { name: string }) => r.name === "Minesweeper").claimed).toBe(true);
    expect((await post(rt, "/api/guest/register", { name: "Clippy", passcode: CODES.event })).status).toBe(409);
    const av = await post(rt, "/api/guest/register", { name: "Norton Anti-Virus", passcode: CODES.event });
    expect(av.status).toBe(409);
    expect(av.json.error).toMatch(/can't be Antivirus/u);
    expect((await post(rt, "/api/guest/register", { name: "The Router", passcode: CODES.event })).status).toBe(409);
  });

  it("a searched program becomes the guest's name + picture; antivirus is greyed out and refused", async () => {
    const w = fakeWiki();
    const img = fakeImages();
    const rt = freshRuntime({ wiki: new WikiClient({ fetch: w.fetch }), images: new ImageCache({ fetch: img.fetch }) });
    const search = await post(rt, "/api/identities/search", { passcode: CODES.event, q: "norton" });
    expect(search.status).toBe(200);
    expect(search.json.results).toEqual([
      { name: "Norton AntiVirus", description: "Anti-virus software", avatar: avatarKey("https://img.test/nav.png"), claimed: false, blocked: "antivirus" },
      { name: "Norton Commander", description: "Discontinued orthodox file manager software", avatar: avatarKey("https://img.test/nc.png"), claimed: false, blocked: null },
    ]);
    // Even a client that ignores the flag can't register it.
    const bad = await post(rt, "/api/guest/register", { name: "Norton AntiVirus", wiki: "Norton AntiVirus", passcode: CODES.event });
    expect(bad.status).toBe(403);
    expect(bad.json.error).toMatch(/antivirus/iu);
    expect((await post(rt, "/api/guest/register", { name: "x", wiki: "Nothing Whatsoever", passcode: CODES.event })).status).toBe(404);

    const ok = await post(rt, "/api/guest/register", { name: "nhl 97", wiki: "NHL 97", passcode: CODES.event });
    expect(ok.status).toBe(200);
    expect(ok.json.name).toBe("NHL 97"); // the canonical title
    expect(ok.json.avatar).toBe(avatarKey("https://img.test/nhl97.png"));
    // Locked for everyone else, and visible as such in a later search.
    expect((await post(rt, "/api/guest/register", { name: "NHL 97", wiki: "NHL 97", passcode: CODES.event })).status).toBe(409);
    const again = await post(rt, "/api/identities/search", { passcode: CODES.event, q: "nhl 97" });
    expect(again.json.results.find((r: { name: string }) => r.name === "NHL 97").claimed).toBe(true);
    // The picture rides every view, keyed by folded name, and serves same-origin.
    const state = await get(rt, `/api/state?role=guest&as=${ok.json.id}`, { moderator: true });
    expect(state.json.avatars["nhl 97"]).toBe(ok.json.avatar);
    const pic = await get(rt, `/api/avatar/${ok.json.avatar}`);
    expect(pic.status).toBe(200);
    expect(pic.headers["content-type"]).toBe("image/png");
    expect(new TextDecoder().decode(pic.raw!)).toBe("PNG:https://img.test/nhl97.png");
    expect((await get(rt, "/api/avatar/0000000000000000")).status).toBe(404);
    expect((await get(rt, "/api/avatar/not-a-key")).status).toBe(404);
  });

  it("a free name still gets a picture looked up, and the book survives a restore", async () => {
    const w = fakeWiki();
    const d = mkdtempSync(join(tmpdir(), "loom-identity-"));
    dirs.push(d);
    const images = new ImageCache({ fetch: fakeImages().fetch });
    const mk = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "t", scenarioSource: SHOW, joinBase: () => "http://x", wiki: new WikiClient({ fetch: w.fetch }), images });
    const rt = mk();
    rt.openDoors();
    const g = await post(rt, "/api/guest/register", { name: "NHL", passcode: CODES.event });
    expect(g.status).toBe(200);
    expect(g.json.avatar).toBeNull(); // looked up in the background
    await tick();
    const st = await get(rt, `/api/state?role=guest&as=${g.json.id}`, { moderator: true });
    // "NHL" has no article of its own; the best software hit is NHL 97, and
    // its best picture is the logo — not the gameplay screenshot it leads with.
    const logo = `https://img.test/${encodeURIComponent("File:NHL 97 logo.svg")}`;
    expect(st.json.avatars["nhl"]).toBe(avatarKey(logo));
    const rt2 = mk();
    rt2.restore();
    expect((await get(rt2, `/api/avatar/${avatarKey(logo)}`)).status).not.toBe(404);
    const st2 = await get(rt2, `/api/state?role=guest&as=${g.json.id}`, { moderator: true });
    expect(st2.json.avatars["nhl"]).toBe(avatarKey(logo));
  });
});

describe("picture options: hand-picked, then the article's gallery", () => {
  const img = (file: string) => `https://img.test/${encodeURIComponent(file)}`;

  it("ranks an article's files: logo / cover over the lead screenshot, no furniture, no glyphs", async () => {
    expect(rankFiles("NHL 97", ["File:NHL 97 gameplay.png", "File:NHL 97 cover.jpg", "File:Commons-logo.svg", "File:NHL 97 logo.svg"], "File:NHL 97 gameplay.png")).toEqual([
      "File:NHL 97 logo.svg",
      "File:NHL 97 cover.jpg",
      "File:NHL 97 gameplay.png",
    ]);
    // A file named exactly after the article is its emblem.
    expect(rankFiles("Microsoft Paint", ["File:Microsoft Paint on Windows 11.png", "File:Microsoft Paint.svg"], "File:Microsoft Paint on Windows 11.png")[0]).toBe("File:Microsoft Paint.svg");
    // The name asked for counts as much as the article's title.
    expect(rankFiles("Office Assistant", ["File:Kevan Atteberry.jpg", "File:Clippy-letter.PNG"], null, "Clippy")[0]).toBe("File:Clippy-letter.PNG");
    const wiki = new WikiClient({ fetch: fakeWiki().fetch });
    const pics = await wiki.pictures("NHL 97");
    expect(pics.map((p) => p.file)).toEqual(["File:NHL 97 logo.svg", "File:NHL 97 cover.jpg", "File:NHL 97 gameplay.png"]); // glyph (16px) + furniture dropped
    expect(pics[0]!.url).toBe(img("File:NHL 97 logo.svg"));
    // An article with no files still offers its lead thumbnail.
    expect((await wiki.pictures("Clippy")).map((p) => p.url)).toEqual(["https://img.test/clippy.png"]);
    expect(await wiki.pictures("Nothing Whatsoever")).toEqual([]);
  });

  it("an authored `avatar:` is a URL or a `File:` name, `|`-separated; a file resolves without the API", () => {
    const src = `# T\nstart: A\n\nCHARACTER Paint\n  avatar: File:Microsoft Paint.svg | https://img.test/p2.png | nonsense\n  wiki: Microsoft Paint\n\n== A\nHi.\n`;
    const d = identityDefs(Sim.fromSources(src).model)[0]!;
    expect(d.avatars).toEqual(["File:Microsoft Paint.svg", "https://img.test/p2.png"]);
    expect(d.wiki).toBe("Microsoft Paint");
    expect(fileUrl("File:Microsoft Paint.svg")).toBe("https://en.wikipedia.org/wiki/Special:FilePath/Microsoft_Paint.svg?width=256");
    expect(avatarRefUrl("https://img.test/p2.png")).toBe("https://img.test/p2.png");
  });

  it("a guest chooses among a program's pictures; only its own options are accepted", async () => {
    const src = `# T\nstart: A\n\nCHARACTER Paint\n  avatar: https://img.test/hand.png | https://img.test/hand2.png\n  wiki: NHL 97\n\n== A\nHi.\n`;
    const d = mkdtempSync(join(tmpdir(), "loom-identity-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "t", scenarioSource: src, joinBase: () => "http://x", wiki: new WikiClient({ fetch: fakeWiki().fetch }), images: new ImageCache({ fetch: fakeImages().fetch }) });
    rt.openDoors();
    expect((await post(rt, "/api/identities/pictures", { passcode: "nope", name: "Paint" })).status).toBe(403);
    const opts = await post(rt, "/api/identities/pictures", { passcode: CODES.event, name: "Paint" });
    expect(opts.status).toBe(200);
    const keys = opts.json.options.map((o: { key: string }) => o.key);
    // Hand-picked first (in order), then the `wiki:` article's gallery.
    expect(keys.slice(0, 3)).toEqual([avatarKey("https://img.test/hand.png"), avatarKey("https://img.test/hand2.png"), avatarKey(img("File:NHL 97 logo.svg"))]);
    expect(opts.json.options[2].file).toBe("NHL 97 logo.svg");
    // Every option is servable before anyone picks it.
    expect((await get(rt, `/api/avatar/${keys[2]}`)).status).toBe(200);
    // A key from somewhere else is refused.
    expect((await post(rt, "/api/guest/register", { name: "Paint", passcode: CODES.event, picture: avatarKey("https://img.test/nc.png") })).status).toBe(400);
    const g = await post(rt, "/api/guest/register", { name: "Paint", passcode: CODES.event, picture: keys[1] });
    expect(g.status).toBe(200);
    expect(g.json.avatar).toBe(keys[1]);
    // A guest's own pick survives the story being reloaded (the seed would
    // otherwise put the first hand-picked one back).
    await post(rt, "/api/mod/reset", {}, undefined, { moderator: true });
    const st = await get(rt, `/api/state?role=mod`, { moderator: true });
    expect(st.json.avatars["paint"]).toBe(keys[1]);
  });

  it("a directory pick offers that article's gallery, and the guest can change their picture later", async () => {
    const rt = freshRuntime({ wiki: new WikiClient({ fetch: fakeWiki().fetch }), images: new ImageCache({ fetch: fakeImages().fetch }) });
    // Searching offers pictures but gives nobody one.
    await post(rt, "/api/identities/search", { passcode: CODES.event, q: "nhl" });
    expect((await get(rt, `/api/state?role=mod`, { moderator: true })).json.avatars["nhl 97"]).toBeUndefined();
    const opts = await post(rt, "/api/identities/pictures", { passcode: CODES.event, wiki: "NHL 97" });
    expect(opts.json.name).toBe("NHL 97");
    expect(opts.json.options.map((o: { file: string }) => o.file)).toEqual(["NHL 97 logo.svg", "NHL 97 cover.jpg", "NHL 97 gameplay.png"]);
    expect((await post(rt, "/api/identities/pictures", { passcode: CODES.event, wiki: "Nothing Whatsoever" })).status).toBe(404);
    const cover = opts.json.options[1].key;
    const g = await post(rt, "/api/guest/register", { name: "NHL 97", wiki: "NHL 97", passcode: CODES.event, picture: cover });
    expect(g.json.avatar).toBe(cover);
    // Later, from the profile: the same options; pick the logo instead.
    const mine = await post(rt, "/api/guest/picture", {}, g.json.token);
    expect(mine.json.avatar).toBe(cover);
    expect(mine.json.options.map((o: { key: string }) => o.key)).toContain(cover);
    const logo = mine.json.options[0].key;
    expect((await post(rt, "/api/guest/picture", { picture: logo }, g.json.token)).json.avatar).toBe(logo);
    expect((await post(rt, "/api/guest/picture", { picture: avatarKey("https://img.test/nc.png") }, g.json.token)).status).toBe(400);
    expect((await post(rt, "/api/guest/picture", { picture: logo })).status).not.toBe(200); // no token
  });

  it("keeps fetched pictures on disk: a fresh cache serves them without the network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-pictures-"));
    dirs.push(dir);
    const f1 = fakeImages();
    const a = new ImageCache({ fetch: f1.fetch, dir });
    expect(a.onDisk("https://img.test/a.png")).toBe(false);
    await a.get("https://img.test/a.png");
    expect(a.onDisk("https://img.test/a.png")).toBe(true);
    const f2 = fakeImages();
    const b = new ImageCache({ fetch: f2.fetch, dir });
    const hit = await b.get("https://img.test/a.png");
    expect(new TextDecoder().decode(hit!.bytes)).toBe("PNG:https://img.test/a.png");
    expect(hit!.contentType).toBe("image/png");
    expect(f2.calls).toEqual([]);
  });

  it("the story's pictures are fetched when it loads, not when a phone first asks", async () => {
    const f = fakeImages();
    const src = `# T\nstart: A\n\nCHARACTER Paint\n  avatar: https://img.test/hand.png\n\n== A\nHi.\n`;
    const d = mkdtempSync(join(tmpdir(), "loom-identity-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "t", scenarioSource: src, joinBase: () => "http://x", images: new ImageCache({ fetch: f.fetch }) });
    rt.openDoors();
    await tick();
    expect(f.calls).toEqual(["https://img.test/hand.png"]);
  });
});

describe("performers: one booth per part", () => {
  it("a second booth can't take a held part; the same booth may re-sign in; a program or prop is refused", async () => {
    const rt = freshRuntime();
    const a = await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    expect(a.status).toBe(200);
    const b = await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    expect(b.status).toBe(409);
    expect(b.json.error).toMatch(/already taken/u);
    const again = await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime }, a.json.token);
    expect(again.status).toBe(200);
    expect(again.json.token).toBe(a.json.token);
    const parts = await post(rt, "/api/identities", { passcode: CODES.prime });
    expect(parts.json.identities.find((r: { name: string }) => r.name === "Clippy").claimed).toBe(true);
    expect(parts.json.identities.find((r: { name: string }) => r.name === "Task Manager").claimed).toBe(false);
    expect((await post(rt, "/api/prime/login", { character: "Calculator", passcode: CODES.prime })).status).toBe(409);
    expect((await post(rt, "/api/prime/login", { character: "Trabolta", passcode: CODES.prime })).status).toBe(409);
    expect((await post(rt, "/api/prime/login", { character: "The Uploader", passcode: CODES.prime })).status).toBe(409);
    expect((await post(rt, "/api/prime/login", { character: "Nobody", passcode: CODES.prime })).status).toBe(404);
    // Switching parts frees the old one.
    expect((await post(rt, "/api/prime/login", { character: "Task Manager", passcode: CODES.prime }, a.json.token)).status).toBe(200);
    expect((await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).status).toBe(200);
  });
});
