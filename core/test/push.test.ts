//! K-31a — Web Push to Android guests + booths. The hub (subscriptions, the
//! hidden flag, pruning), the send rule (`!` alerts always; a character's DM
//! and a booth readout only while hidden), config from the environment (a
//! missing key disables push cleanly), and the runtime wiring end to end
//! with a fake push service.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import webpush from "web-push";
import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ChatMessage } from "../server/chat.ts";
import { SUBSCRIBE_PER_MINUTE } from "../server/routes/k31.ts";
import { HTML_CSP, PLAY_CSP, PLAY_PWA_FILES, REINSTALL_CSP } from "../server/routing.ts";
import {
  MAX_DEVICES,
  MAX_DEVICES_PER_OWNER,
  isDeadStatus,
  PushHub,
  messagePush,
  isPushServiceHost,
  parseSubscription,
  pushConfigFromEnv,
  readoutPush,
  webPushSender,
  type PushSender,
  type PushSubscriptionJSON,
} from "../server/push.ts";

const CODES = { event: "EVT331", prime: "PRM331", mod: "MOD331" };

const SOURCE = `# Push Night
start: Opening

LOCATION Hall

ROLE Guest

CHARACTER Trabolta

CHARACTER Norton
  when scanned by guest:
    Norton: Clean.
  when alarm_tripped:
    reply 🚨 Server room breach. Get there.

== Opening
  setting: Hall
The lights come on.
`;

function sub(n: number): PushSubscriptionJSON {
  return { endpoint: `https://fcm.googleapis.com/fcm/send/dev-${n}`, keys: { p256dh: `p256-${n}`, auth: `auth-${n}` } };
}

interface Sent {
  endpoint: string;
  payload: { kind: string; title: string; body: string; tag: string };
  ttl: number;
  urgency: string;
}
function fakeSender(status: (endpoint: string) => number = () => 201): PushSender & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    publicKey: "BPUBLIC",
    sent,
    async send(s, payload, opts) {
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload), ttl: opts.ttl, urgency: opts.urgency });
      return status(s.endpoint);
    },
  };
}

function memHub(sender: PushSender | null, seed: unknown = null) {
  let saved: unknown = seed;
  let writes = 0;
  let t = 1000;
  const hub = new PushHub({ sender, load: () => saved, save: (d) => ((saved = d), writes++), now: () => ++t, log: () => {} });
  return { hub, saved: () => saved, writes: () => writes };
}

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    seq: 7,
    channel: "lobby",
    channelKind: "lobby" as ChatMessage["channelKind"],
    title: "Lobby",
    from: "",
    kind: "line",
    text: "hello",
    ts: 0,
    audience: "all",
    parentSeq: null,
    hidden: false,
    ...over,
  } as ChatMessage;
}

describe("config", () => {
  it("is off without both keys, on with them; the subject defaults to the https base URL", () => {
    expect(pushConfigFromEnv({})).toBeNull();
    expect(pushConfigFromEnv({ LOOM_VAPID_PUBLIC_KEY: "x" })).toBeNull();
    expect(pushConfigFromEnv({ LOOM_VAPID_PUBLIC_KEY: "x", LOOM_VAPID_PRIVATE_KEY: " " })).toBeNull();
    expect(pushConfigFromEnv({ LOOM_VAPID_PUBLIC_KEY: "x", LOOM_VAPID_PRIVATE_KEY: "y", LOOM_BASE_URL: "https://app.mapsandducks.com" })).toEqual({
      publicKey: "x",
      privateKey: "y",
      subject: "https://app.mapsandducks.com",
    });
    expect(pushConfigFromEnv({ LOOM_VAPID_PUBLIC_KEY: "x", LOOM_VAPID_PRIVATE_KEY: "y", LOOM_VAPID_SUBJECT: "mailto:a@b.c" })?.subject).toBe("mailto:a@b.c");
  });

  it("builds a sender from real keys and refuses bad ones (push stays off, no throw)", () => {
    const keys = webpush.generateVAPIDKeys();
    const ok = webPushSender({ ...keys, subject: "mailto:show@example.com" }, () => {});
    expect(ok?.publicKey).toBe(keys.publicKey);
    const logs: string[] = [];
    expect(webPushSender({ publicKey: "nope", privateKey: "nope", subject: "mailto:show@example.com" }, (m) => logs.push(m))).toBeNull();
    expect(logs.join("")).toMatch(/push disabled/);
    expect(webPushSender(null)).toBeNull();
  });
});

describe("parseSubscription", () => {
  it("takes an https endpoint with both keys, nothing else", () => {
    expect(parseSubscription(sub(1))).toEqual(sub(1));
    expect(parseSubscription({ ...sub(1), endpoint: "http://192.168.1.2/x" })).toBeNull();
    expect(parseSubscription({ ...sub(1), endpoint: "not a url" })).toBeNull();
    expect(parseSubscription({ endpoint: sub(1).endpoint, keys: { p256dh: "a" } })).toBeNull();
    expect(parseSubscription({ endpoint: sub(1).endpoint })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });

  it("only names a known push service — no IP literals, no other hosts, no ports (SSRF)", () => {
    const at = (endpoint: string) => parseSubscription({ ...sub(1), endpoint });
    expect(at("https://web.push.apple.com/QGx")).not.toBeNull();
    expect(at("https://updates.push.services.mozilla.com/wpush/v2/x")).not.toBeNull();
    expect(at("https://wns2-par02p.notify.windows.com/w/?token=x")).not.toBeNull();
    expect(at("https://10.0.0.1/x")).toBeNull();
    expect(at("https://[::1]/x")).toBeNull();
    expect(at("https://evil.example/x")).toBeNull();
    expect(at("https://fcm.googleapis.com.evil.example/x")).toBeNull();
    expect(at("https://evilpush.apple.com/x")).toBeNull();
    expect(at("https://push.apple.com/x")).toBeNull();
    expect(at("https://fcm.googleapis.com:8443/fcm/send/x")).toBeNull();
    expect(at("https://user@fcm.googleapis.com/fcm/send/x")).toBeNull();
    expect(isPushServiceHost("FCM.googleapis.com")).toBe(true);
    expect(isPushServiceHost("127.0.0.1")).toBe(false);
  });
});

describe("messagePush (the send rule)", () => {
  it("an alert pushes always; a character DM only while hidden; room chat never", () => {
    const alert = messagePush(msg({ alert: true, text: "Come to the Desktop.", from: "" }), "Trapped");
    expect(alert).toMatchObject({ always: true, payload: { kind: "alert", title: "🚨 Trapped", body: "Come to the Desktop.", tag: "alert-7" } });
    const dm = messagePush(msg({ channel: "dm:Trabolta", from: "Trabolta", audience: ["g-1"], text: "Hello, program." }), "Trapped");
    expect(dm).toMatchObject({ always: false, payload: { kind: "dm", title: "Trabolta", tag: "dm:Trabolta" } });
    expect(messagePush(msg({ channel: "loc:Hall", from: "g-1" }), "Trapped")).toBeNull();
    // The guest's own typed reply into the thread is not the character speaking.
    expect(messagePush(msg({ channel: "dm:Trabolta", from: "Winamp", audience: ["g-1"] }), "Trapped")).toBeNull();
    expect(messagePush(msg({ channel: "dm:Trabolta", kind: "narration" as ChatMessage["kind"] }), "Trapped")).toBeNull();
    expect(messagePush(msg({ alert: true, hidden: true }), "Trapped")).toBeNull();
  });

  it("clips a long body; a readout is titled by the booth", () => {
    const long = messagePush(msg({ alert: true, text: "x".repeat(500) }), "T")!;
    expect(long.payload.body.length).toBe(240);
    expect(readoutPush("Norton", "🚨 breach")).toMatchObject({ kind: "readout", title: "🎭 Norton", tag: "readout:Norton" });
  });
});

describe("PushHub", () => {
  it("binds a device to one owner, moves it on re-subscribe, caps devices per owner", () => {
    const { hub, saved } = memHub(fakeSender());
    hub.subscribe("guest:a", sub(1));
    hub.subscribe("guest:b", sub(1)); // same phone, now someone else
    expect(hub.status().guests).toEqual([{ id: "b", devices: 1, hidden: 0 }]);
    for (let i = 2; i < 2 + MAX_DEVICES_PER_OWNER + 2; i++) hub.subscribe("guest:a", sub(i));
    expect(hub.status().guests.find((g) => g.id === "a")?.devices).toBe(MAX_DEVICES_PER_OWNER);
    // Persisted, and reloads.
    const again = memHub(fakeSender(), saved()).hub;
    expect(again.status()).toEqual(hub.status());
  });

  it("a repeat subscribe refreshes in memory without rewriting push.json", () => {
    const { hub, writes } = memHub(fakeSender());
    hub.subscribe("guest:a", sub(1));
    expect(writes()).toBe(1);
    hub.setHidden("guest:a", sub(1).endpoint, true);
    for (let i = 0; i < 20; i++) hub.subscribe("guest:a", sub(1));
    expect(writes()).toBe(1);
    expect(hub.status().guests).toEqual([{ id: "a", devices: 1, hidden: 0 }]);
    hub.subscribe("guest:a", { ...sub(1), keys: { p256dh: "new", auth: "new" } }); // rotated keys → saved
    expect(writes()).toBe(2);
  });

  it("only the owner flips a device's hidden flag or removes it", () => {
    const { hub } = memHub(fakeSender());
    hub.subscribe("guest:a", sub(1));
    expect(hub.setHidden("guest:b", sub(1).endpoint, true)).toBe(0);
    expect(hub.setHidden("guest:a", sub(1).endpoint, true)).toBe(1);
    expect(hub.status().guests[0]!.hidden).toBe(1);
    expect(hub.setHidden("guest:a", "", false)).toBe(1); // no endpoint → all mine
    expect(hub.unsubscribe("guest:b", sub(1).endpoint)).toBe(false);
    expect(hub.unsubscribe("guest:a", sub(1).endpoint)).toBe(true);
    expect(hub.owners()).toEqual([]);
  });

  it("always → every device; otherwise hidden devices only; high urgency + per-kind TTL", async () => {
    const sender = fakeSender();
    const { hub } = memHub(sender);
    hub.subscribe("guest:a", sub(1));
    hub.subscribe("guest:a", sub(2));
    hub.setHidden("guest:a", sub(2).endpoint, true);
    const p = { kind: "dm" as const, title: "Trabolta", body: "hi", tag: "dm:Trabolta", url: "/" };
    expect(hub.notify("guest:a", p, false)).toBe(1);
    expect(hub.notify("guest:a", { ...p, kind: "alert" }, true)).toBe(2);
    await hub.settle();
    expect(sender.sent.map((s) => [s.endpoint.slice(-5), s.payload.kind])).toEqual([
      ["dev-2", "dm"],
      ["dev-1", "alert"],
      ["dev-2", "alert"],
    ]);
    expect(sender.sent.every((s) => s.urgency === "high")).toBe(true);
    expect(sender.sent[0]!.ttl).toBe(1800);
    expect(sender.sent[1]!.ttl).toBe(600);
  });

  it("prunes a device the push service says is gone (404 / 410), keeps one that failed transiently", async () => {
    const sender = fakeSender((ep) => (ep.endsWith("dev-1") ? 410 : ep.endsWith("dev-2") ? 404 : 500));
    const { hub } = memHub(sender);
    for (const n of [1, 2, 3]) hub.subscribe("prime:Norton", sub(n));
    hub.notify("prime:Norton", readoutPush("Norton", "x"), true);
    await hub.settle();
    expect(hub.status().booths).toEqual([{ character: "Norton", devices: 1, hidden: 0 }]);
  });

  it("prunes on any 4xx but 429 (a junk key never comes back); 429 / 5xx / network errors keep it", async () => {
    expect([400, 401, 403, 404, 410, 413].every(isDeadStatus)).toBe(true);
    expect([0, 201, 429, 500, 503].some(isDeadStatus)).toBe(false);
    const codes: Record<string, number> = { "dev-1": 400, "dev-2": 403, "dev-3": 429, "dev-4": 502 };
    const sender = fakeSender((ep) => codes[ep.slice(-5)] ?? 201);
    const { hub } = memHub(sender);
    for (const n of [1, 2]) hub.subscribe("guest:a", sub(n));
    for (const n of [3, 4]) hub.subscribe("guest:b", sub(n));
    hub.notify("guest:a", readoutPush("N", "x"), true);
    hub.notify("guest:b", readoutPush("N", "x"), true);
    await hub.settle();
    expect(hub.status().guests).toEqual([{ id: "b", devices: 2, hidden: 0 }]);
  });

  it("caps devices across every owner: a new device past MAX_DEVICES is refused, a known one still refreshes", () => {
    const { hub, writes } = memHub(fakeSender());
    for (let i = 0; i < MAX_DEVICES; i++) expect(hub.subscribe(`guest:g${i}`, sub(i))).toBe(true);
    const w = writes();
    expect(hub.subscribe("guest:late", sub(MAX_DEVICES + 1))).toBe(false);
    expect(writes()).toBe(w);
    expect(hub.owners()).not.toContain("guest:late");
    expect(hub.subscribe("guest:g0", sub(0))).toBe(true); // a repeat is fine
    expect(hub.subscribe("guest:late", sub(0))).toBe(true); // moving an existing device is fine
    hub.drop((o) => o === "guest:g1");
    expect(hub.subscribe("guest:late", sub(MAX_DEVICES + 1))).toBe(true); // room again
  });

  it("disabled (no sender): sends nothing", () => {
    const { hub } = memHub(null);
    hub.subscribe("guest:a", sub(1));
    expect(hub.enabled).toBe(false);
    expect(hub.publicKey).toBeNull();
    expect(hub.notify("guest:a", readoutPush("N", "x"), true)).toBe(0);
  });
});

describe("serving the service worker", () => {
  it("play's CSP allows its own worker + manifest without touching the reinstall rule", () => {
    expect(PLAY_CSP.startsWith(HTML_CSP)).toBe(true);
    expect(PLAY_CSP).toContain("worker-src 'self'");
    expect(PLAY_CSP).toContain("manifest-src 'self'");
    expect(HTML_CSP).not.toContain("worker-src"); // REINSTALL_CSP appends its own
    expect(REINSTALL_CSP).toContain("worker-src 'self' blob:");
    expect([...PLAY_PWA_FILES].sort()).toEqual(["/manifest.webmanifest", "/sw.js"]);
  });
});

// --- the runtime, end to end with a fake push service ------------------------

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function runtime(sender: PushSender | null) {
  const d = mkdtempSync(join(tmpdir(), "loom-push-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "push",
    scenarioSource: SOURCE,
    joinBase: () => "https://app.example.com",
    push: sender,
  });
}
function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
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
async function call(rt: EventRuntime, method: string, path: string, body: Record<string, unknown>, opts: { moderator?: boolean } = {}) {
  const res = fakeRes();
  await rt.handle(fakeReq(body), res, method, path, new URL(`http://x${path}`), opts);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
const post = (rt: EventRuntime, path: string, body: Record<string, unknown>) => call(rt, "POST", path, body);
const mod = (rt: EventRuntime, path: string, body: Record<string, unknown>) => call(rt, "POST", path, body, { moderator: true });

async function register(rt: EventRuntime, name: string) {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}

describe("EventRuntime push wiring", () => {
  it("config answers enabled + the public key; disabled without keys, and subscribe says so", async () => {
    const on = runtime(fakeSender());
    expect((await call(on, "GET", "/api/push/config", {})).json).toEqual({ enabled: true, publicKey: "BPUBLIC" });
    const off = runtime(null);
    off.openDoors();
    expect((await call(off, "GET", "/api/push/config", {})).json).toEqual({ enabled: false, publicKey: null });
    const g = await register(off, "Winamp");
    expect((await post(off, "/api/push/subscribe", { token: g.token, subscription: sub(1) })).status).toBe(503);
  });

  it("guest: `!` alert pushes even while visible; Trabolta's DM only once the page says hidden", async () => {
    const sender = fakeSender();
    const rt = runtime(sender);
    rt.openDoors();
    const ana = await register(rt, "Winamp");
    const bob = await register(rt, "Napster");
    expect((await post(rt, "/api/push/subscribe", { subscription: sub(1) })).status).toBe(401);
    expect((await post(rt, "/api/push/subscribe", { token: ana.token, subscription: { endpoint: "http://lan/x" } })).status).toBe(400);
    expect((await post(rt, "/api/push/subscribe", { token: ana.token, subscription: sub(1) })).status).toBe(200);
    expect((await post(rt, "/api/push/subscribe", { token: bob.token, subscription: sub(2) })).status).toBe(200);

    expect((await mod(rt, "/api/mod/broadcast", { scope: "everyone", cue: "!Come to the Desktop." })).status).toBe(200);
    await rt.push.settle();
    expect(sender.sent.map((s) => [s.endpoint.slice(-5), s.payload.kind, s.payload.body])).toEqual([
      ["dev-1", "alert", "Come to the Desktop."],
      ["dev-2", "alert", "Come to the Desktop."],
    ]);
    sender.sent.length = 0;

    // A DM while Ana's app is showing: SSE carries it, no push.
    expect((await mod(rt, "/api/mod/say", { as: "Trabolta", channel: `guest:${ana.id}`, text: "Hello, program." })).status).toBe(200);
    await rt.push.settle();
    expect(sender.sent).toEqual([]);

    // She locks the phone (the sendBeacon) → the next DM pushes, to her only.
    expect((await post(rt, "/api/push/visible", { token: ana.token, endpoint: sub(1).endpoint, hidden: true })).json).toEqual({ ok: true, devices: 1 });
    expect((await mod(rt, "/api/mod/say", { as: "Trabolta", channel: `guest:${ana.id}`, text: "Are you there?" })).status).toBe(200);
    await rt.push.settle();
    expect(sender.sent.map((s) => [s.endpoint.slice(-5), s.payload.title, s.payload.body])).toEqual([["dev-1", "Trabolta", "Are you there?"]]);
    sender.sent.length = 0;

    // Her own message into the thread never pushes back to her.
    expect((await post(rt, "/api/guest/say", { token: ana.token, channel: "dm:Trabolta", text: "yes" })).status).toBe(200);
    await rt.push.settle();
    expect(sender.sent).toEqual([]);

    const status = await mod(rt, "/api/mod/push/status", {});
    expect(status.json.enabled).toBe(true);
    expect(status.json.guests).toEqual(
      expect.arrayContaining([
        { id: ana.id, name: "Winamp", devices: 1, hidden: 1 },
        { id: bob.id, name: "Napster", devices: 1, hidden: 0 },
      ]),
    );
    expect((await post(rt, "/api/mod/push/status", { token: ana.token })).status).toBe(403);
  });

  it("booth: gets every `!` alert, and its door-alarm readout when locked; release unbinds it", async () => {
    const sender = fakeSender();
    const rt = runtime(sender);
    rt.openDoors();
    const booth = await post(rt, "/api/prime/login", { character: "Norton", passcode: CODES.prime });
    expect(booth.status).toBe(200);
    const token = booth.json.token as string;
    expect((await post(rt, "/api/push/subscribe", { token, subscription: sub(9) })).status).toBe(200);

    // Visible booth: the readout is the in-page alert (K-06), not a push.
    expect((await mod(rt, "/api/mod/signal", { name: "alarm_tripped" })).status).toBe(200);
    await rt.push.settle();
    expect(sender.sent).toEqual([]);
    await post(rt, "/api/push/visible", { token, endpoint: sub(9).endpoint, hidden: true });
    expect((await mod(rt, "/api/mod/signal", { name: "alarm_tripped" })).status).toBe(200);
    await mod(rt, "/api/mod/broadcast", { scope: "everyone", cue: "!Lockdown." });
    await rt.push.settle();
    expect(sender.sent.map((s) => [s.payload.kind, s.payload.title, s.payload.body])).toEqual([
      ["readout", "🎭 Norton", "🚨 Server room breach. Get there."],
      ["alert", "🚨 Push Night", "📣 Lockdown."],
    ]);

    // A story reset keeps the booth (performers stay signed in)…
    const g = await register(rt, "Winamp");
    await post(rt, "/api/push/subscribe", { token: g.token, subscription: sub(1) });
    expect(rt.push.status().guests).toEqual([{ id: g.id, devices: 1, hidden: 0 }]);
    expect((await mod(rt, "/api/mod/reset", {})).status).toBe(200);
    expect(rt.push.status().guests).toEqual([]); // guests' phones are dropped…
    expect(rt.push.owners()).toEqual(["prime:Norton"]); // …the booth's kept
    // …release (N-10) drops it; so does go-live.
    expect((await mod(rt, "/api/mod/prime/release", { character: "Norton" })).status).toBe(200);
    expect(rt.push.owners()).toEqual([]);
  });

  it("refuses a director's play-as session (Run → Players never registers a worker)", async () => {
    const rt = runtime(fakeSender());
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const imp = await mod(rt, "/api/mod/impersonate", { role: "guest", id: g.id });
    expect(imp.status).toBe(200);
    expect((await post(rt, "/api/push/subscribe", { token: imp.json.token, subscription: sub(1) })).status).toBe(401);
  });

  it("rate-limits subscribe per owner (429), and refuses a non-push-service endpoint (400)", async () => {
    const rt = runtime(fakeSender());
    rt.openDoors();
    const g = await register(rt, "Winamp");
    expect((await post(rt, "/api/push/subscribe", { token: g.token, subscription: { ...sub(1), endpoint: "https://10.0.0.1/x" } })).status).toBe(400);
    let last = 0;
    for (let i = 0; i < SUBSCRIBE_PER_MINUTE + 1; i++) last = (await post(rt, "/api/push/subscribe", { token: g.token, subscription: sub(1) })).status;
    expect(last).toBe(429);
    const other = await register(rt, "Napster");
    expect((await post(rt, "/api/push/subscribe", { token: other.token, subscription: sub(2) })).status).toBe(200);
  });

  it("refuses a guest's subscribe while the doors are closed (409); a booth may still bind", async () => {
    const rt = runtime(fakeSender());
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const booth = await post(rt, "/api/prime/login", { character: "Norton", passcode: CODES.prime });
    rt.pause();
    expect((await post(rt, "/api/push/subscribe", { token: g.token, subscription: sub(1) })).status).toBe(409);
    expect((await post(rt, "/api/push/subscribe", { token: booth.json.token, subscription: sub(2) })).status).toBe(200);
    expect(rt.push.owners()).toEqual(["prime:Norton"]);
    rt.openDoors();
    expect((await post(rt, "/api/push/subscribe", { token: g.token, subscription: sub(1) })).status).toBe(200);
  });
});
