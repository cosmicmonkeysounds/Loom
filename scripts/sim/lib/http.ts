// The bots' HTTP: one client per event, every call timed into the Recorder,
// tokens in the `x-loom-token` header (never in a URL the log could print),
// and a tiny SSE reader for the guests' live streams. No dependencies.

import { routeKey, type Recorder } from "./report.ts";

export interface Res<T = Record<string, unknown>> {
  status: number;
  json: T;
}

export class Client {
  /** `/e/<id>` once resolved; "" talks to the default event's bare paths. */
  scope = "";
  readonly base: string;
  readonly rec: Recorder;
  constructor(base: string, rec: Recorder) {
    this.base = base;
    this.rec = rec;
  }

  async call<T = Record<string, unknown>>(method: "GET" | "POST", path: string, opts: { token?: string; body?: unknown; root?: boolean } = {}): Promise<Res<T>> {
    const url = `${this.base}${opts.root === true ? "" : this.scope}${path}`;
    const t0 = performance.now();
    let status = 0;
    let json = {} as T;
    try {
      const r = await fetch(url, {
        method,
        headers: {
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(opts.token !== undefined ? { "x-loom-token": opts.token } : {}),
        },
        body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      status = r.status;
      const text = await r.text();
      try {
        json = (text === "" ? {} : JSON.parse(text)) as T;
      } catch {
        json = {} as T;
      }
    } catch (e) {
      status = 0;
      json = { error: (e as Error).message } as T;
    }
    this.rec.time(routeKey(method, path), performance.now() - t0);
    return { status, json };
  }

  get<T = Record<string, unknown>>(path: string, token?: string): Promise<Res<T>> {
    return this.call<T>("GET", path, { token });
  }

  post<T = Record<string, unknown>>(path: string, body: unknown, token?: string): Promise<Res<T>> {
    return this.call<T>("POST", path, { token, body });
  }
}

/** A short, secret-free description of a failed answer: `POST /api/x → 409 moved`. */
export function failure(method: string, path: string, r: Res): string {
  const err = typeof r.json["error"] === "string" ? ` ${String(r.json["error"]).slice(0, 120)}` : "";
  return `${method} ${path.split("?")[0]} → ${r.status}${err}`;
}

/** A live SSE stream held open for a bot (presence + delivery count). */
export class Stream {
  frames = 0;
  open = false;
  private ac = new AbortController();
  readonly url: string;
  readonly token: string;
  private onFrame: ((event: string, data: string) => void) | undefined;

  constructor(url: string, token: string, onFrame?: (event: string, data: string) => void) {
    this.url = url;
    this.token = token;
    this.onFrame = onFrame;
  }

  start(): this {
    void this.run();
    return this;
  }

  private async run(): Promise<void> {
    try {
      const r = await fetch(this.url, { headers: { "x-loom-token": this.token, accept: "text/event-stream" }, signal: this.ac.signal });
      if (!r.ok || r.body === null) return;
      this.open = true;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/mu.exec(frame)?.[1];
          const data = /^data: (.*)$/mu.exec(frame)?.[1];
          if (ev === undefined || data === undefined) continue;
          this.frames += 1;
          this.onFrame?.(ev, data);
        }
      }
    } catch {
      /* aborted or dropped */
    } finally {
      this.open = false;
    }
  }

  stop(): void {
    this.ac.abort();
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Is this server the laptop itself? The host is anchored: `localhost`,
 *  `127.x.x.x` or `[::1]`, then an optional port, then a path or the end, so
 *  `localhost.example.com` or `127.0.0.1.nip.io` (a public name) is not. */
export const isLocal = (base: string): boolean => /^https?:\/\/(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?(\/|$)/iu.test(base);
