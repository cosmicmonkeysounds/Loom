//! The shared harness of the wave 13 fix-round server tests (lane fapi):
//! a small story with a host part (`admin: true` or not), an EventRuntime
//! on a temp state dir, and the route callers the Play app's calls mirror.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime, type EventRuntimeInit } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { expect } from "vitest";

export const CODES = { event: "EVT132", prime: "PRM132", mod: "MOD132" };

export const story = (admin: boolean): string => `# Fix Night
start: Opening

ROLE Program
  uploaded: bool = false
  cleared: bool = false

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION Hall

CHARACTER Task Manager
  faction: Hosts
${admin ? "  admin: true\n" : ""}  when greet for program:
    reply Hello {program.name}.

CHARACTER Clippy
  faction: Hosts
  when answered for program:
    if Night.bottle_open == true:
      reply Accepted.
    else:
      broadcast "🗣 The bottle is not on {program.name}." to channel(hosts)
  when nudge for program:
    set program.cleared = program.cleared

CHARACTER Norton
  when scanned by program:
    if not program.uploaded:
      Self: Not yet. Finish your upload.
    else:
      reply Clean: {program.name}.

CHARACTER Trabolta
  mind: external
  hold: One moment.

INTERACTION answered
  who: performer

INTERACTION greet
  who: performer

INTERACTION nudge
  who: performer

INTERACTION open the doors
  who: admin

== Opening
  setting: Hall
Hello.
`;

const dirs: string[] = [];
/** Remove every state dir `freshDir` made (each test file's `afterAll`). */
export function cleanup(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}
export function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-w13fix-"));
  dirs.push(d);
  return d;
}
export function runtime(extra: Partial<EventRuntimeInit> = {}, dir: string = freshDir(), source = story(true)): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "fix", scenarioSource: source, joinBase: () => "http://localhost", ...extra });
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
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    headers: {} as Record<string, string>,
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    write(c: unknown) {
      buf += String(c);
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    frames(type: string): unknown[] {
      return buf
        .split("\n\n")
        .filter((f) => f.startsWith(`event: ${type}\n`))
        .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)));
    },
  };
  return res;
}
export type Reply = { status: number; json: Record<string, unknown> };
export async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: Record<string, unknown> = {}, opts: { moderator?: boolean; moderatorName?: string } = {}): Promise<Reply> {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res as unknown as ServerResponse, method, url.pathname, url, opts);
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}");
  } catch {
    json = { raw: res.body };
  }
  return { status: res.statusCode, json };
}
export const post = (rt: EventRuntime, path: string, body: Record<string, unknown> = {}) => call(rt, "POST", path, body);
export const get = (rt: EventRuntime, path: string) => call(rt, "GET", path);
export const mod = (rt: EventRuntime, path: string, body: Record<string, unknown> = {}) => call(rt, "POST", path, body, { moderator: true, moderatorName: "Ada" });

export async function register(rt: EventRuntime, name: string): Promise<Reply> {
  return post(rt, "/api/guest/register", { name, passcode: CODES.event });
}
export async function guest(rt: EventRuntime, name: string): Promise<{ id: string; token: string }> {
  const r = await register(rt, name);
  expect(r.status, name).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}
export async function booth(rt: EventRuntime, character: string, token?: string): Promise<Reply> {
  return post(rt, "/api/prime/login", { character, passcode: CODES.prime, ...(token !== undefined ? { token } : {}) });
}
export function guestStream(rt: EventRuntime, token: string) {
  const res = fakeRes();
  const open = rt.handle(fakeReq(null), res as unknown as ServerResponse, "GET", "/events", new URL(`http://x/events?role=guest&token=${encodeURIComponent(token)}`), {});
  return { open, res };
}
export function primeStream(rt: EventRuntime, token: string) {
  const res = fakeRes();
  const open = rt.handle(fakeReq(null), res as unknown as ServerResponse, "GET", "/events", new URL(`http://x/events?role=prime&token=${encodeURIComponent(token)}`), {});
  return { open, res };
}
