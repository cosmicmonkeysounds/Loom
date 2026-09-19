//! The wall terminals' voice: `TtsProxy` fronts an OpenAI-compatible speech
//! endpoint with a bounded LRU + in-flight de-duplication, and the
//! `/api/mod/tts` route is moderator-gated and maps every outcome to a
//! status a terminal can act on (503 → fall back to the browser voice).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { SpeechCache, TtsProxy, clampSpeed, cleanVoice, normaliseSpeech, speechKey, ttsConfigFromEnv, type FetchLike } from "../server/tts.ts";
import { scenarioSource } from "../examples/load.ts";

const CONFIG = ttsConfigFromEnv({ LOOM_TTS_URL: "http://voice:8880/v1/", LOOM_TTS_VOICE: "am_michael" });

/** A fake speech endpoint: answers `<text>` as bytes, counts calls. */
function fakeEndpoint(opts: { status?: number; empty?: boolean } = {}): { fetch: FetchLike; calls: Array<{ url: string; body: Record<string, unknown> }> } {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, body });
    const status = opts.status ?? 200;
    const bytes = opts.empty ? new Uint8Array(0) : new TextEncoder().encode(`AUDIO:${String(body["input"])}`);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => (n === "content-type" ? "audio/mpeg" : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      text: async () => "boom",
    };
  };
  return { fetch, calls };
}

describe("tts config + helpers", () => {
  it("is disabled without LOOM_TTS_URL and strips a trailing slash otherwise", () => {
    expect(ttsConfigFromEnv({}).baseUrl).toBeNull();
    expect(CONFIG.baseUrl).toBe("http://voice:8880/v1");
    expect(CONFIG.model).toBe("kokoro");
    expect(CONFIG.format).toBe("mp3");
    expect(ttsConfigFromEnv({ LOOM_TTS_URL: "x", LOOM_TTS_FORMAT: "wav" }).format).toBe("wav");
    expect(ttsConfigFromEnv({ LOOM_TTS_URL: "x", LOOM_TTS_FORMAT: "flac" }).format).toBe("mp3");
  });
  it("normalises whitespace, clamps speed, and refuses odd voice names", () => {
    expect(normaliseSpeech("  Hello,\n\n  program.  ")).toBe("Hello, program.");
    expect(clampSpeed(0.1)).toBe(0.5);
    expect(clampSpeed(9)).toBe(2);
    expect(clampSpeed("1.25")).toBe(1.25);
    expect(clampSpeed("fast")).toBe(1);
    expect(cleanVoice("af_bella+af_sky", "am_michael")).toBe("af_bella+af_sky");
    expect(cleanVoice("../etc", "am_michael")).toBe("am_michael");
    expect(cleanVoice(42, "am_michael")).toBe("am_michael");
  });
  it("keys a line by text + voice + speed + format", () => {
    const a = speechKey({ text: "hi", voice: "v", speed: 1 }, "mp3");
    expect(speechKey({ text: "hi", voice: "v", speed: 1 }, "mp3")).toBe(a);
    expect(speechKey({ text: "hi", voice: "w", speed: 1 }, "mp3")).not.toBe(a);
    expect(speechKey({ text: "hi", voice: "v", speed: 1.1 }, "mp3")).not.toBe(a);
    expect(speechKey({ text: "hi", voice: "v", speed: 1 }, "wav")).not.toBe(a);
  });
});

describe("SpeechCache", () => {
  it("evicts least-recently-used entries past the entry and byte caps", () => {
    const c = new SpeechCache(2, 1000);
    c.set("a", new Uint8Array(10));
    c.set("b", new Uint8Array(10));
    expect(c.get("a")).toBeDefined(); // a is now the most recent
    c.set("c", new Uint8Array(10));
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBeDefined();
    expect(c.get("c")).toBeDefined();
    const big = new SpeechCache(10, 25);
    big.set("x", new Uint8Array(20));
    big.set("y", new Uint8Array(10));
    expect(big.get("x")).toBeUndefined(); // over 25 bytes → oldest went
    expect(big.size).toBe(1);
    big.set("z", new Uint8Array(100)); // larger than the whole cache: never stored
    expect(big.get("z")).toBeUndefined();
  });
});

describe("TtsProxy", () => {
  it("reports disabled with no endpoint, and never calls out", async () => {
    const ep = fakeEndpoint();
    const p = new TtsProxy(ttsConfigFromEnv({}), { fetch: ep.fetch });
    expect(p.enabled).toBe(false);
    expect(p.describe().available).toBe(false);
    expect(await p.speak({ text: "hello" })).toEqual({ kind: "disabled" });
    expect(ep.calls).toHaveLength(0);
  });
  it("posts the OpenAI speech shape, caches the answer, and de-duplicates concurrent calls", async () => {
    const ep = fakeEndpoint();
    const p = new TtsProxy(CONFIG, { fetch: ep.fetch });
    const [a, b] = await Promise.all([p.speak({ text: "Hello,  program." }), p.speak({ text: "Hello, program." })]);
    expect(a.kind).toBe("audio");
    expect(b.kind).toBe("audio");
    expect(ep.calls).toHaveLength(1); // the two identical requests shared one upstream call
    expect(ep.calls[0]!.url).toBe("http://voice:8880/v1/audio/speech");
    expect(ep.calls[0]!.body).toEqual({ model: "kokoro", input: "Hello, program.", voice: "am_michael", speed: 1, response_format: "mp3" });
    expect(new TextDecoder().decode((a as { bytes: Uint8Array }).bytes)).toBe("AUDIO:Hello, program.");
    const again = await p.speak({ text: "Hello, program." });
    expect(again.kind === "audio" && again.cached).toBe(true);
    expect(ep.calls).toHaveLength(1);
    // A different voice or pace is a different line.
    await p.speak({ text: "Hello, program.", voice: "bm_george", speed: 1.2 });
    expect(ep.calls).toHaveLength(2);
    expect(ep.calls[1]!.body["voice"]).toBe("bm_george");
    expect(ep.calls[1]!.body["speed"]).toBe(1.2);
  });
  it("sends the bearer token when one is configured", async () => {
    const seen: Record<string, string>[] = [];
    const fetch: FetchLike = async (_u, init) => {
      seen.push(init.headers);
      const bytes = new Uint8Array([1]);
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => bytes.buffer as ArrayBuffer, text: async () => "" };
    };
    const p = new TtsProxy(ttsConfigFromEnv({ LOOM_TTS_URL: "https://api.openai.com/v1", LOOM_TTS_API_KEY: "sk-x", LOOM_TTS_MODEL: "tts-1", LOOM_TTS_VOICE: "onyx" }), { fetch });
    const r = await p.speak({ text: "hi" });
    expect(r.kind).toBe("audio");
    expect(r.kind === "audio" && r.contentType).toBe("audio/mpeg"); // the configured format's type when the endpoint names none
    expect(seen[0]!["authorization"]).toBe("Bearer sk-x");
  });
  it("refuses empty / oversized text and reports an endpoint failure without caching it", async () => {
    const ep = fakeEndpoint({ status: 500 });
    const p = new TtsProxy(CONFIG, { fetch: ep.fetch });
    expect((await p.speak({ text: "   " })).kind).toBe("bad");
    expect((await p.speak({ text: "x".repeat(1201) })).kind).toBe("bad");
    const failed = await p.speak({ text: "hello" });
    expect(failed.kind).toBe("failed");
    expect(failed.kind === "failed" && failed.error).toContain("500");
    await p.speak({ text: "hello" });
    expect(ep.calls).toHaveLength(2); // not cached — retried upstream
    const empty = new TtsProxy(CONFIG, { fetch: fakeEndpoint({ empty: true }).fetch });
    expect((await empty.speak({ text: "hello" })).kind).toBe("failed");
    const down = new TtsProxy(CONFIG, {
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const r = await down.speak({ text: "hello" });
    expect(r.kind === "failed" && r.error).toContain("unreachable");
  });
});

// --- the route ---------------------------------------------------------------

const SCENARIO = scenarioSource("escape-the-internet");
const CODES = { event: "EVT111", prime: "PRM111", mod: "MOD111" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function runtimeWith(tts: TtsProxy): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-tts-"));
  dirs.push(d);
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "escape-the-internet", scenarioSource: SCENARIO, joinBase: () => "http://localhost", tts });
}
function fakeReq(body: unknown, token?: string): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: token ? { "x-loom-token": token } : {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
interface Captured {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | string;
}
function fakeRes(): ServerResponse & Captured {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "" as Buffer | string,
    writeHead(s: number, h?: Record<string, string>) {
      res.statusCode = s;
      if (h) res.headers = h;
      return res;
    },
    write() {
      return true;
    },
    end(b?: Buffer | string) {
      if (b !== undefined) res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & Captured;
}
async function call(rt: EventRuntime, method: string, path: string, body: unknown, opts: { token?: string; moderator?: boolean } = {}) {
  const res = fakeRes();
  await rt.handle(fakeReq(body, opts.token), res, method, path, new URL(`http://x${path}${opts.token && method === "GET" ? `?token=${opts.token}` : ""}`), { moderator: opts.moderator });
  return res;
}

describe("/api/mod/tts", () => {
  it("is moderator-gated, describes the voice, and streams audio bytes", async () => {
    const ep = fakeEndpoint();
    const rt = runtimeWith(new TtsProxy(CONFIG, { fetch: ep.fetch }));
    expect((await call(rt, "GET", "/api/mod/tts", {})).statusCode).toBe(403);
    expect((await call(rt, "POST", "/api/mod/tts", { text: "hi" })).statusCode).toBe(403);
    const login = await call(rt, "POST", "/api/mod/login", { passcode: "MOD111" });
    const token = (JSON.parse(String(login.body)) as { token: string }).token;
    const info = await call(rt, "GET", "/api/mod/tts", {}, { token });
    expect(info.statusCode).toBe(200);
    expect(JSON.parse(String(info.body))).toEqual({ available: true, voice: "am_michael", model: "kokoro", format: "mp3" });
    const audio = await call(rt, "POST", "/api/mod/tts", { text: "Say that again, program.", speed: 1.1 }, { token });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/mpeg");
    expect(audio.headers["x-loom-tts-cache"]).toBe("miss");
    expect(Buffer.isBuffer(audio.body) && audio.body.toString()).toBe("AUDIO:Say that again, program.");
    const second = await call(rt, "POST", "/api/mod/tts", { text: "Say that again, program.", speed: 1.1 }, { moderator: true });
    expect(second.headers["x-loom-tts-cache"]).toBe("hit");
    expect(ep.calls).toHaveLength(1);
  });
  it("answers 503 when no endpoint is configured, 400 on nothing to say, 502 when the endpoint fails", async () => {
    const off = runtimeWith(new TtsProxy(ttsConfigFromEnv({})));
    expect((await call(off, "POST", "/api/mod/tts", { text: "hi" }, { moderator: true })).statusCode).toBe(503);
    expect(JSON.parse(String((await call(off, "GET", "/api/mod/tts", {}, { moderator: true })).body)).available).toBe(false);
    const on = runtimeWith(new TtsProxy(CONFIG, { fetch: fakeEndpoint().fetch }));
    expect((await call(on, "POST", "/api/mod/tts", { text: "" }, { moderator: true })).statusCode).toBe(400);
    const broken = runtimeWith(new TtsProxy(CONFIG, { fetch: fakeEndpoint({ status: 500 }).fetch }));
    expect((await call(broken, "POST", "/api/mod/tts", { text: "hi" }, { moderator: true })).statusCode).toBe(502);
  });
});
