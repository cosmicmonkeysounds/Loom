//! N-02 — re-pair a lost guest (`/api/mod/guest/pair` mints a single-use,
//! ten-minute pair code; the phone trades it at `/api/guest/resume` for a
//! fresh token for the SAME Person, so codex / score survive and no ghost is
//! left behind).
//! N-10 — release a performer's part (`/api/mod/prime/release`): the dead
//! booth's session loses the character, its stream closes, and the part can
//! be signed into again from a loaner.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { SessionStore } from "../server/session.ts";
import { HOMESCREEN_KEEP, PAIR_TTL_MS, releasePart, resumeUrl } from "../server/routes/n02.ts";

const CODES = { event: "EVT202", prime: "PRM202", mod: "MOD202" };

const SOURCE = `# Pairing
start: Opening

LOCATION Hall

ROLE Guest

CHARACTER Clippy
  when scanned by guest:
    Clippy: It looks like you're scanning.

CHARACTER Norton
  when scanned by guest:
    Norton: Clean.

CODEX The Secret
  about: Clippy
  code: SECRET-1
  text: Clippy remembers everything.

== Opening
  setting: Hall
The lights come on.
`;

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-pair-"));
  dirs.push(d);
  return d;
}
function runtimeAt(d: string, now?: () => number): EventRuntime {
  return new EventRuntime({
    ...(now !== undefined ? { now } : {}),
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "pairing",
    scenarioSource: SOURCE,
    joinBase: () => "https://app.example.com",
  });
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, onClose?: (fn: () => void) => void): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") onClose?.(fn);
    },
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}
async function mod(rt: EventRuntime, path: string, body: unknown) {
  const res = fakeRes();
  await rt.handle(fakeReq(body), res, "POST", path, new URL(`http://x${path}`), { moderator: true, moderatorName: "Ada" });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function post(rt: EventRuntime, path: string, body: Record<string, unknown>, token?: string) {
  const res = fakeRes();
  await rt.handle(fakeReq(token !== undefined ? { ...body, token } : body), res, "POST", path, new URL(`http://x${path}`), {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function state(rt: EventRuntime, role: "guest" | "prime", token: string) {
  const res = fakeRes();
  const url = new URL(`http://x/api/state?role=${role}&token=${token}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
function stream(rt: EventRuntime, query: string) {
  let ended = false;
  const res = {
    writeHead() {
      return res;
    },
    write() {
      return true;
    },
    end() {
      ended = true;
      return res;
    },
  } as unknown as ServerResponse;
  void rt.handle(fakeReq(null), res, "GET", "/events", new URL(`http://x/events?${query}`), {});
  return { isEnded: () => ended };
}
async function resume(rt: EventRuntime, pair: string) {
  return post(rt, "/api/guest/resume", { pair });
}
/** Pair `id` and trade the code at once → the new phone's token. */
async function pairToken(rt: EventRuntime, id: string, extra: Record<string, unknown> = {}) {
  const paired = await mod(rt, "/api/mod/guest/pair", { id, ...extra });
  expect(paired.status).toBe(200);
  const r = await resume(rt, paired.json.pair as string);
  expect(r.status).toBe(200);
  return { paired: paired.json, token: r.json.token as string };
}
async function register(rt: EventRuntime, name: string) {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}

describe("resumeUrl / releasePart", () => {
  it("builds the re-pair link off the public join base", () => {
    expect(resumeUrl("https://app.example.com/", "EVT 1", "t/k")).toBe("https://app.example.com/?code=EVT%201&pair=t%2Fk");
  });
  it("takes the part off every holder; an admin keeps admin", () => {
    const s = new SessionStore();
    s.set("a", { character: "Clippy", admin: false, host: false });
    s.set("b", { character: "Clippy", admin: true, host: false });
    s.set("c", { character: "Norton", admin: false, host: false });
    expect(releasePart(s, "Clippy")).toBe(2);
    expect(s.has("a")).toBe(false);
    expect(s.get("b")).toEqual({ character: null, admin: true, host: false });
    expect(s.characterOf("c")).toBe("Norton");
    expect(releasePart(s, "Clippy")).toBe(0);
  });
});

describe("N-02 re-pair a guest", () => {
  it("mints a fresh token for the same Person: score + codex intact, no new Person", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const ana = await register(rt, "Winamp");
    expect((await post(rt, "/api/guest/codex/redeem", { code: "SECRET-1" }, ana.token)).status).toBe(200);
    expect((await mod(rt, "/api/mod/set", { id: ana.id, field: "score", value: 7 })).status).toBe(200);
    const before = rt.liveSim!.persons.size;

    const paired = await mod(rt, "/api/mod/guest/pair", { id: ana.id });
    expect(paired.status).toBe(200);
    expect(paired.json).toMatchObject({ ok: true, id: ana.id, name: "Winamp" });
    // The director's QR never carries a token — only the pair code.
    expect(paired.json.token).toBeUndefined();
    const pair = paired.json.pair as string;
    expect(paired.json.url).toBe(`https://app.example.com/?code=EVT202&pair=${pair}`);
    const traded = await resume(rt, pair);
    expect(traded.status).toBe(200);
    expect(traded.json).toMatchObject({ ok: true, id: ana.id, name: "Winamp" });
    const token = traded.json.token as string;
    expect(token).not.toBe(ana.token);
    // Single use.
    expect((await resume(rt, pair)).status).toBe(410);

    // The new phone IS Ana: same id, her codex, her score.
    const view = await state(rt, "guest", token);
    expect(view.status).toBe(200);
    expect(view.json).toMatchObject({ id: ana.id, name: "Winamp", score: 7 });
    expect(view.json.codex.map((e: { id: string }) => e.id)).toEqual(["The Secret"]);
    expect(rt.liveSim!.persons.size).toBe(before);
    // It can act as her; the spent code was a release, so the old phone is out.
    expect((await post(rt, "/api/guest/say", { channel: "lobby", text: "back in" }, token)).status).toBe(200);
    expect((await state(rt, "guest", ana.token)).status).toBe(401);

    // Persisted like a registration: a server restart keeps it…
    const again = runtimeAt(d);
    expect(again.restore()).not.toBeNull();
    expect((await state(again, "guest", token)).json.id).toBe(ana.id);
    // …and a story restart cuts it, like every guest token.
    expect((await mod(again, "/api/mod/reset", {})).status).toBe(200);
    expect((await state(again, "guest", token)).status).toBe(401);
  });

  it("is moderator-only and refuses an unknown guest", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const ana = await register(rt, "Winamp");
    expect((await post(rt, "/api/mod/guest/pair", { id: ana.id })).status).toBe(403);
    expect((await post(rt, "/api/mod/guest/pair", { id: ana.id }, ana.token)).status).toBe(403);
    expect((await mod(rt, "/api/mod/guest/pair", { id: "g-nobody" })).status).toBe(404);
  });

  it("refuses a director's persona (409) — personas are puppeted, never paired", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const persona = await mod(rt, "/api/mod/persona", { name: "Ada's persona" });
    expect(persona.status).toBe(200);
    const r = await mod(rt, "/api/mod/guest/pair", { id: persona.json.guest.id });
    expect(r.status).toBe(409);
    expect(r.json.token).toBeUndefined();
  });

  it("revokeOthers cuts the lost phone: its tokens and stream go, the new token works", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const ana = await register(rt, "Winamp");
    const bob = await register(rt, "Napster");
    const lost = stream(rt, `role=guest&token=${ana.token}`);
    const bobs = stream(rt, `role=guest&token=${bob.token}`);
    const { paired, token } = await pairToken(rt, ana.id, { revokeOthers: true });
    expect(paired.revoked).toBe(1);
    expect(lost.isEnded()).toBe(true);
    expect(bobs.isEnded()).toBe(false);
    expect((await state(rt, "guest", ana.token)).status).toBe(401);
    expect((await state(rt, "guest", token)).json.id).toBe(ana.id);
    expect((await state(rt, "guest", bob.token)).status).toBe(200);
    // Without the flag the old token holds until the code is spent…
    const paired2 = await mod(rt, "/api/mod/guest/pair", { id: ana.id });
    expect(paired2.json.revoked).toBe(0);
    expect((await state(rt, "guest", token)).status).toBe(200);
    // …and spending it signs that phone out too: one holder.
    const moved = await resume(rt, paired2.json.pair as string);
    expect((await state(rt, "guest", token)).status).toBe(401);
    expect((await state(rt, "guest", moved.json.token as string)).json.id).toBe(ana.id);
  });
});

describe("N-02 pair codes", () => {
  it("expire after ten minutes; a newer QR voids the older; a restart voids them all", async () => {
    let t = 1_000_000;
    const rt = runtimeAt(freshDir(), () => t);
    rt.openDoors();
    const ana = await register(rt, "Winamp");
    const old = (await mod(rt, "/api/mod/guest/pair", { id: ana.id })).json.pair as string;
    t += PAIR_TTL_MS + 1;
    expect((await resume(rt, old)).status).toBe(410);

    const first = (await mod(rt, "/api/mod/guest/pair", { id: ana.id })).json.pair as string;
    const second = (await mod(rt, "/api/mod/guest/pair", { id: ana.id })).json.pair as string;
    expect(second).not.toBe(first);
    expect((await resume(rt, first)).status).toBe(410);
    t += PAIR_TTL_MS - 1000;
    expect((await resume(rt, second)).status).toBe(200);

    const pending = (await mod(rt, "/api/mod/guest/pair", { id: ana.id })).json.pair as string;
    expect((await mod(rt, "/api/mod/reset", {})).status).toBe(200);
    expect((await resume(rt, pending)).status).toBe(410);
  });

  it("a guest's own token is no re-pair link: resume needs a director's code", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const ana = await register(rt, "Winamp");
    expect((await resume(rt, ana.token)).status).toBe(410);
    expect((await resume(rt, "")).status).toBe(410);
    expect((await post(rt, "/api/guest/resume", {})).status).toBe(410);
  });
});

describe("N-10 release a performer's part", () => {
  it("frees a held part: the dead booth is cut, a loaner signs in with the threads intact", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const booth = await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    expect(booth.status).toBe(200);
    const dead = booth.json.token as string;
    expect((await post(rt, "/api/prime/say", { channel: "lobby", text: "before the phone died" }, dead)).status).toBe(200);
    const live = stream(rt, `role=prime&token=${dead}`);
    // The loaner is refused while the dead phone holds the part.
    expect((await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).status).toBe(409);

    const rel = await mod(rt, "/api/mod/prime/release", { character: "Clippy" });
    expect(rel.status).toBe(200);
    expect(rel.json).toMatchObject({ ok: true, character: "Clippy", released: 1 });
    expect(live.isEnded()).toBe(true);
    expect((await post(rt, "/api/prime/say", { channel: "lobby", text: "x" }, dead)).status).toBe(403);
    // Persisted: a server restart doesn't resurrect the dead booth.
    const rebooted = runtimeAt(d);
    expect(rebooted.restore()).not.toBeNull();
    expect((await post(rebooted, "/api/prime/say", { channel: "lobby", text: "x" }, dead)).status).toBe(403);

    const loaner = await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    expect(loaner.status).toBe(200);
    const view = await state(rt, "prime", loaner.json.token as string);
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.json)).toContain("Clippy");
    // Releasing an unheld part is a no-op; an unknown one is a 404.
    expect((await mod(rt, "/api/mod/prime/release", { character: "Norton" })).json.released).toBe(0);
    expect((await mod(rt, "/api/mod/prime/release", { character: "Nobody" })).status).toBe(404);
  });

  it("a booth's own Sign out frees its part: the Home Screen icon signs in with no director", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const safari = (await post(rt, "/api/prime/login", { character: "Norton", passcode: CODES.prime })).json.token as string;
    // The icon has its own storage: while Safari holds Norton, it's "taken".
    expect((await post(rt, "/api/prime/login", { character: "Norton", passcode: CODES.prime })).status).toBe(409);
    expect(await post(rt, "/api/prime/logout", {}, safari)).toMatchObject({ status: 200, json: { ok: true } });
    expect((await post(rt, "/api/prime/say", { channel: "lobby", text: "x" }, safari)).status).toBe(403);
    expect(runtimeAt(d).restore()).not.toBeNull(); // persisted
    const icon = await post(rt, "/api/prime/login", { character: "Norton", passcode: CODES.prime });
    expect(icon.status).toBe(200);
    // A dead / missing token is still signed out; an admin keeps admin.
    expect((await post(rt, "/api/prime/logout", {}, "nope")).status).toBe(200);
    expect((await post(rt, "/api/prime/logout", {})).status).toBe(200);
    const both = (await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).json.token as string;
    expect((await post(rt, "/api/mod/login", { passcode: CODES.mod }, both)).status).toBe(200);
    expect((await post(rt, "/api/prime/logout", {}, both)).status).toBe(200);
    expect((await post(rt, "/api/mod/say", { channel: "lobby", text: "still directing" }, both)).status).toBe(200);
    expect((await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).status).toBe(200);
  });

  it("a performer who is also an admin keeps the admin capability", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const booth = await post(rt, "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    const token = booth.json.token as string;
    expect((await post(rt, "/api/mod/login", { passcode: CODES.mod }, token)).status).toBe(200);
    expect((await mod(rt, "/api/mod/prime/release", { character: "Clippy" })).json.released).toBe(1);
    // Still a moderator, no longer Clippy.
    expect((await post(rt, "/api/mod/say", { channel: "lobby", text: "still directing" }, token)).status).toBe(200);
    expect((await post(rt, "/api/prime/say", { channel: "lobby", text: "x" }, token)).status).toBe(403);
    expect((await post(rt, "/api/mod/prime/release", { character: "Clippy" })).status).toBe(403);
  });
});

describe("K-31b Home Screen nonce", () => {
  const withSwitch = async (on: boolean, fn: () => Promise<void>) => {
    const prev = process.env.LOOM_HOMESCREEN;
    if (on) process.env.LOOM_HOMESCREEN = "on";
    else delete process.env.LOOM_HOMESCREEN;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.LOOM_HOMESCREEN;
      else process.env.LOOM_HOMESCREEN = prev;
    }
  };
  const homescreen = (rt: EventRuntime, token?: string) => post(rt, "/api/guest/homescreen", {}, token);

  it("is off by default: 404, nothing minted", async () => {
    await withSwitch(false, async () => {
      const rt = runtimeAt(freshDir());
      rt.openDoors();
      const ana = await register(rt, "Winamp");
      expect((await homescreen(rt, ana.token)).status).toBe(404);
    });
  });

  it("a guest mints a single-use nonce for themselves; it ADDS a token, the Safari one stays good", async () => {
    await withSwitch(true, async () => {
      const rt = runtimeAt(freshDir());
      rt.openDoors();
      const ana = await register(rt, "Winamp");
      const hit = await homescreen(rt, ana.token);
      expect(hit.status).toBe(200);
      expect(hit.json.code).toBe(CODES.event);
      expect(hit.json.manifest).toBe(`/manifest.webmanifest?code=${CODES.event}&pair=${encodeURIComponent(hit.json.pair as string)}`);
      const icon = await resume(rt, hit.json.pair as string);
      expect(icon.status).toBe(200);
      expect(icon.json.id).toBe(ana.id);
      expect(icon.json.token).not.toBe(ana.token);
      expect((await state(rt, "guest", ana.token)).status).toBe(200);
      expect((await state(rt, "guest", icon.json.token as string)).json.id).toBe(ana.id);
      // Spent the moment it's presented.
      expect((await resume(rt, hit.json.pair as string)).status).toBe(410);
    });
  });

  it("needs a guest token; the newest three stay good; it lives 12 h; a director's QR doesn't void it", async () => {
    await withSwitch(true, async () => {
      let t = 5_000_000;
      const rt = runtimeAt(freshDir(), () => t);
      rt.openDoors();
      const ana = await register(rt, "Winamp");
      expect((await homescreen(rt)).status).toBe(401);
      expect((await homescreen(rt, "nope")).status).toBe(401);
      // A tab reloaded between Add to Home Screen and the icon's first open
      // mints again: the icon's nonce must survive a few of those.
      const minted: string[] = [];
      for (let i = 0; i <= HOMESCREEN_KEEP; i++) minted.push((await homescreen(rt, ana.token)).json.pair as string);
      expect((await resume(rt, minted[0]!)).status).toBe(410); // the oldest dropped
      expect((await resume(rt, minted[1]!)).status).toBe(200);
      const second = minted[2]!;
      // A director's re-pair QR in between leaves the icon's nonce alone.
      expect((await mod(rt, "/api/mod/guest/pair", { id: ana.id })).status).toBe(200);
      t += PAIR_TTL_MS + 60_000; // well past a QR's life, well inside the icon's
      expect((await resume(rt, second)).status).toBe(200);
      const late = (await homescreen(rt, ana.token)).json.pair as string;
      t += 12 * 60 * 60_000 + 1;
      expect((await resume(rt, late)).status).toBe(410);
    });
  });

  it("a restart clears every nonce; revokeOthers voids the lost phone's", async () => {
    await withSwitch(true, async () => {
      const rt = runtimeAt(freshDir());
      rt.openDoors();
      const ana = await register(rt, "Winamp");
      const nonce = (await homescreen(rt, ana.token)).json.pair as string;
      expect((await mod(rt, "/api/mod/guest/pair", { id: ana.id, revokeOthers: true })).status).toBe(200);
      expect((await resume(rt, nonce)).status).toBe(410);

      const bob = await register(rt, "Napster");
      const pending = (await homescreen(rt, bob.token)).json.pair as string;
      expect((await mod(rt, "/api/mod/reset", {})).status).toBe(200);
      expect((await resume(rt, pending)).status).toBe(410);
    });
  });
});
