//! The event server's mod API, as the mind uses it.
//!
//! Wire contract (`core/server/event-runtime.ts`):
//!   auth      `POST /api/mod/login {passcode}` → `{token}`; then `x-loom-token`
//!   feed      `GET /events?role=mod` (SSE: snapshot / history / message / sim)
//!   read      `GET /api/state?role=mod` · `GET /api/state?role=guest&as=<id>`
//!             · `GET /api/state?role=prime&as=<Character>`
//!   speak     `POST /api/mod/say {as, channel: "guest:<id>", text}`
//!   nudge     `POST /api/mod/var {path, value}`
//!   fire      `POST /api/mod/signal {name, subject?, actor?}`
//!
//! Paths are `/e/<eventId>/…` unless the event is `default`, which targets
//! the server's bare back-compat routes.

export class ModApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ModApiError";
  }
}

export interface ModClientOptions {
  server: string;
  event: string;
  token?: string;
  passcode?: string;
  fetchImpl?: typeof fetch;
}

export class ModClient {
  readonly server: string;
  readonly event: string;
  token: string | null;
  private readonly passcode: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(o: ModClientOptions) {
    this.server = o.server.replace(/\/+$/u, "");
    this.event = o.event;
    this.token = o.token ?? null;
    this.passcode = o.passcode ?? null;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  /** Event-scoped path. */
  path(p: string): string {
    return this.event === "" || this.event === "default" ? p : `/e/${encodeURIComponent(this.event)}${p}`;
  }

  url(p: string): string {
    return `${this.server}${this.path(p)}`;
  }

  get feedUrl(): string {
    return this.url("/events?role=mod");
  }

  headers(): Record<string, string> {
    return this.token ? { "x-loom-token": this.token } : {};
  }

  /** Exchange the passcode for a token when we have none. */
  async ensureToken(): Promise<void> {
    if (this.token !== null) return;
    if (this.passcode === null) throw new ModApiError("no mod token and no mod passcode", 0);
    const r = await this.fetchImpl(this.url("/api/mod/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: this.passcode }),
    });
    if (!r.ok) throw new ModApiError(`mod login failed (${r.status})`, r.status);
    this.token = ((await r.json()) as { token: string }).token;
  }

  async post<T = Record<string, unknown>>(p: string, body: unknown): Promise<T> {
    await this.ensureToken();
    let r = await this.send(p, body);
    if (r.status === 403 && this.passcode !== null) {
      // The session may have been reset server-side — log in once more.
      this.token = null;
      await this.ensureToken();
      r = await this.send(p, body);
    }
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new ModApiError((data["error"] as string) || `POST ${p} → ${r.status}`, r.status);
    return data as T;
  }

  private send(p: string, body: unknown): Promise<Response> {
    return this.fetchImpl(this.url(p), {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers() },
      body: JSON.stringify(body ?? {}),
    });
  }

  async get<T>(p: string): Promise<T> {
    await this.ensureToken();
    const r = await this.fetchImpl(this.url(p), { headers: this.headers() });
    if (!r.ok) throw new ModApiError(`GET ${p} → ${r.status}`, r.status);
    return (await r.json()) as T;
  }

  // --- the calls a mind makes -------------------------------------------

  say(as: string, guestId: string, text: string): Promise<unknown> {
    return this.post("/api/mod/say", { as, channel: `guest:${guestId}`, text });
  }

  setVar(path: string, value: string | number | boolean): Promise<unknown> {
    return this.post("/api/mod/var", { path, value: String(value) });
  }

  signal(name: string, subject?: string, actor?: string): Promise<unknown> {
    return this.post("/api/mod/signal", { name, subject: subject ?? "", actor: actor ?? "" });
  }

  modState<T>(): Promise<T> {
    return this.get<T>("/api/state?role=mod");
  }

  guestState<T>(id: string): Promise<T> {
    return this.get<T>(`/api/state?role=guest&as=${encodeURIComponent(id)}`);
  }

  primeState<T>(character: string): Promise<T> {
    return this.get<T>(`/api/state?role=prime&as=${encodeURIComponent(character)}`);
  }
}
