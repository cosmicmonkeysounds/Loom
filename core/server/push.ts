//! Web Push to phones (K-31a — Android + booths; SW-PLAY-19 / SW-PLAY-22,
//! the minimal slice). Transport-free like `SpatialHub`: the hub owns the
//! subscriptions and the send rule; the actual HTTP to the push service is a
//! `PushSender` (`webPushSender` in production, a fake in tests).
//!
//! - **Config.** VAPID keys come from the environment (`LOOM_VAPID_PUBLIC_KEY`
//!   / `LOOM_VAPID_PRIVATE_KEY`, generated once with
//!   `npx web-push generate-vapid-keys`, plus `LOOM_VAPID_SUBJECT`, a
//!   `mailto:` or `https:` contact). A missing or invalid key disables push
//!   cleanly: `/api/push/config` answers `{enabled: false}`, the play app
//!   shows no 🔔 card, and nothing else changes. **Never rotate the keys
//!   before the party**: every subscription is bound to the public key.
//! - **Who.** One owner per device: `guest:<person id>` or
//!   `prime:<character>` (a booth). An endpoint is one device, so a
//!   re-subscribe under another owner *moves* it. Kept as `push.json` in the
//!   event's state dir (not journaled — a phone is not a story fact).
//! - **Visibility.** Each device carries the client's last
//!   `visibilitychange` flag (a `sendBeacon` to `/api/push/visible`). "SSE
//!   disconnected" is the wrong test: a locked iPhone's socket looks open
//!   for minutes.
//! - **What pushes.** `!` alerts **always** (the flag may be stale, and an
//!   app in the foreground is caught by the service worker, which shows no
//!   duplicate) — to every guest who can see one; a booth hears only a
//!   house-wide alert or one in an authored room (a staff back-room's pin),
//!   never an alert addressed to a single guest (their own `!` pin: the
//!   booth's cue is its readout). A character's DM to a guest, and an
//!   unsolicited booth readout (the door alarm, the late list), only when
//!   the device says it is *hidden*. A wallet card: the approver's held
//!   card always, to that character's booth alone; a request / offer / coin
//!   received only while hidden (`messagePush`). Every push carries a visible notification (iOS revokes a
//!   subscription that receives silent pushes). Any 4xx from the push
//!   service except 429 (404 / 410 gone, 400 / 401 / 403 a junk or revoked
//!   subscription) prunes the device; 429 / 5xx / network errors keep it.
//! - **Limits.** Endpoints must be on a known push service
//!   (`PUSH_SERVICE_HOSTS` — no SSRF), subscribe is rate-limited per owner
//!   (`routes/k31.ts`), a guest can't subscribe while the doors are closed,
//!   the whole event holds at most `MAX_DEVICES` (a new device past it is
//!   refused — never evicting a real guest's), and a repeat subscribe writes
//!   nothing.
//! - **Out (K-31a):** director push, `notify`, a health card, send-side
//!   rate limits, quiet modes, the install-first door gate (iPhone is K-31b).

import webpush from "web-push";

import type { ChatMessage } from "./chat.ts";

/** A browser `PushSubscription.toJSON()`, the part the server needs. */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What the service worker turns into a notification. */
export interface PushPayload {
  /** `alert` (a `!` broadcast), `dm` (a character's DM), `readout` (a booth). */
  kind: "alert" | "dm" | "readout";
  title: string;
  body: string;
  /** Collapses repeats (`dm:Trabolta` keeps one notification per thread). */
  tag: string;
  /** Where a tap lands, relative to the service worker's scope. */
  url: string;
}

export interface SendOptions {
  /** Seconds the push service holds an undelivered message. */
  ttl: number;
  /** `high` wakes a dozing Android at once. */
  urgency: "high" | "normal";
}

/** The push service, behind one call. Resolves the HTTP status (2xx = sent);
 *  never rejects. */
export interface PushSender {
  readonly publicKey: string;
  send(sub: PushSubscriptionJSON, payload: string, opts: SendOptions): Promise<number>;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The VAPID subject when nothing better is configured (Apple may refuse it). */
const LOCALHOST_SUBJECT = "mailto:push@localhost";

/** The VAPID config from the environment, or null (push off). */
export function pushConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = (env.LOOM_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.LOOM_VAPID_PRIVATE_KEY ?? "").trim();
  if (publicKey === "" || privateKey === "") return null;
  const base = (env.LOOM_BASE_URL ?? "").trim();
  const subject = (env.LOOM_VAPID_SUBJECT ?? "").trim() || (base.startsWith("https://") ? base : LOCALHOST_SUBJECT);
  return { publicKey, privateKey, subject };
}

/** A `PushSender` over the `web-push` library, or null when the keys don't
 *  validate (logged once; push stays off rather than crashing the boot). */
export function webPushSender(config: PushConfig | null, log: (msg: string) => void = (m) => process.stderr.write(m)): PushSender | null {
  if (config === null) return null;
  try {
    // Validates the subject + both keys (throws on a bad one).
    webpush.getVapidHeaders("https://push.example.com", config.subject, config.publicKey, config.privateKey, "aes128gcm");
  } catch (err) {
    log(`  ⚠️  push disabled — LOOM_VAPID_* is invalid: ${(err as Error).message}\n`);
    return null;
  }
  if (config.subject === LOCALHOST_SUBJECT) {
    log(`  ⚠️  push: no LOOM_VAPID_SUBJECT and LOOM_BASE_URL isn't https — some push services refuse ${LOCALHOST_SUBJECT}\n`);
  }
  const vapidDetails = { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey };
  return {
    publicKey: config.publicKey,
    async send(sub, payload, opts) {
      try {
        const r = await webpush.sendNotification(sub, payload, { TTL: opts.ttl, urgency: opts.urgency, vapidDetails, timeout: 10_000 });
        return r.statusCode;
      } catch (err) {
        const status = (err as { statusCode?: unknown }).statusCode;
        return typeof status === "number" ? status : 0;
      }
    },
  };
}

/** A push-service answer that means the device will never take a push:
 *  any 4xx but 429 (Too Many Requests is transient). */
export function isDeadStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

/** Owner keys. */
export const guestOwner = (id: string): string => `guest:${id}`;
export const boothOwner = (character: string): string => `prime:${character}`;

/** One subscribed device. */
interface Device {
  owner: string;
  sub: PushSubscriptionJSON;
  /** The page's last reported visibility (`true` = hidden / locked). */
  hidden: boolean;
  /** When it last subscribed or reported (wall clock, ms). */
  at: number;
}

/** A device past this many per owner drops the oldest (a guest re-joining
 *  from a fresh browser profile, again and again). */
export const MAX_DEVICES_PER_OWNER = 4;
/** Devices across every owner (a ~60-guest party needs ~100). Past it a
 *  new device is refused, so a registration loop can't grow `push.json`
 *  (rewritten whole on every subscribe) or the fan-out of every alert. */
export const MAX_DEVICES = 300;
const MAX_ENDPOINT = 1024;
const MAX_KEY = 256;
const MAX_BODY = 240;

/** How long the push service may hold each kind (seconds). An alert is news
 *  for the K-06 window; a DM can wait a little longer. */
export const TTL: Record<PushPayload["kind"], number> = { alert: 600, dm: 1800, readout: 600 };

/** The browsers' push services — the only hosts a subscription may name.
 *  Anything else would let a guest aim the server's POSTs at any host
 *  (SSRF). `.`-prefixed entries match that domain's subdomains. */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  "fcm.googleapis.com", // Chrome / Android
  ".push.apple.com", // Safari / iOS (web.push.apple.com)
  "updates.push.services.mozilla.com", // Firefox
  ".notify.windows.com", // Edge (WNS)
];

/** True when `host` is one of the push services (never an IP literal). */
export function isPushServiceHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/u, "");
  if (h === "" || h.startsWith("[") || /^[\d.]+$/u.test(h)) return false;
  return PUSH_SERVICE_HOSTS.some((allowed) => (allowed.startsWith(".") ? h.endsWith(allowed) && h.length > allowed.length : h === allowed));
}

/** A subscription a client sent, validated — or null. Only `https:`
 *  endpoints on a known push service are accepted (the server must never be
 *  aimed at the LAN or an arbitrary host), on the default port. */
export function parseSubscription(raw: unknown): PushSubscriptionJSON | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof r.endpoint !== "string" || r.endpoint.length > MAX_ENDPOINT) return null;
  let url: URL;
  try {
    url = new URL(r.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return null;
  if (!isPushServiceHost(url.hostname)) return null;
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (p256dh === "" || auth === "" || p256dh.length > MAX_KEY || auth.length > MAX_KEY) return null;
  return { endpoint: r.endpoint, keys: { p256dh, auth } };
}

/**
 * SW-PLAY-20: where tapping the notification lands — the play app opens
 * `room` (a server channel id; `scanner` = a booth's scan readouts) once
 * signed in, and ignores one this participant doesn't list.
 */
export function roomUrl(room: string): string {
  return `/?room=${encodeURIComponent(room)}`;
}

function clip(text: string): string {
  const t = text.replace(/\s+/gu, " ").trim();
  return t.length > MAX_BODY ? `${t.slice(0, MAX_BODY - 1)}…` : t;
}

/**
 * The send rule for one delivered chat message: the payload, and whether it
 * goes to every entitled device (`always`) or only to hidden ones. Null =
 * this message never pushes (typed chat in rooms, narration, cards…).
 * Recipients are the caller's job (the same visibility rules as the SSE
 * delivery).
 */
export function messagePush(m: ChatMessage, eventTitle: string): { payload: PushPayload; always: boolean } | null {
  if (m.hidden) return null;
  if (m.alert === true) {
    return { always: true, payload: { kind: "alert", title: `🚨 ${eventTitle}`, body: clip(m.text), tag: `alert-${m.seq}`, url: roomUrl(m.channel) } };
  }
  // A wallet card: the approver's held card always (someone is waiting on
  // them); a card that asks something of its viewer (a request, an offer,
  // coin received) only while their page is hidden. Never the `alert` kind
  // — a booth's wallet card is addressed `@<Character>`, which the
  // booth-alert narrowing would drop.
  if (m.kind === "wallet" && m.wallet) {
    const w = m.wallet;
    if (w.kind === "approval" && w.step === "held") {
      return { always: true, payload: { kind: "dm", title: "🧾 Approval needed", body: clip(m.text), tag: `wallet-${w.id}`, url: roomUrl(m.channel) } };
    }
    if (w.step === "asked" || w.step === "offered" || w.step === "received") {
      return { always: false, payload: { kind: "dm", title: `💰 ${eventTitle}`, body: clip(m.text), tag: `wallet-${w.id}`, url: roomUrl(m.channel) } };
    }
    return null;
  }
  // A DM thread is `dm:<Character>`; only the character's own lines push
  // (never the guest's typed reply, never a director's puppet guest).
  if (m.channel.startsWith("dm:") && m.kind === "line" && m.from !== "" && m.from === m.channel.slice(3)) {
    return { always: false, payload: { kind: "dm", title: m.from, body: clip(m.text), tag: m.channel, url: roomUrl(m.channel) } };
  }
  return null;
}

/** A booth readout (`respond` → the booth's own line), pushed when hidden. */
export function readoutPush(character: string, text: string): PushPayload {
  return { kind: "readout", title: `🎭 ${character}`, body: clip(text), tag: `readout:${character}`, url: roomUrl("scanner") };
}

export interface PushHubInit {
  /** Null → push disabled (no keys). */
  sender: PushSender | null;
  /** Persistence (`push.json` in the event's state dir). */
  load(): unknown;
  save(data: unknown): void;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface PushStatus {
  enabled: boolean;
  guests: Array<{ id: string; devices: number; hidden: number }>;
  booths: Array<{ character: string; devices: number; hidden: number }>;
}

export class PushHub {
  private readonly devices = new Map<string, Device>(); // by endpoint
  private readonly sender: PushSender | null;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  /** Sends in flight (tests await `settle()`). */
  private inflight = new Set<Promise<unknown>>();

  constructor(private readonly init: PushHubInit) {
    this.sender = init.sender;
    this.now = init.now ?? Date.now;
    this.log = init.log ?? ((m) => process.stderr.write(m));
    const raw = init.load();
    const list = raw !== null && typeof raw === "object" && Array.isArray((raw as { devices?: unknown }).devices) ? (raw as { devices: unknown[] }).devices : [];
    for (const d of list) {
      const dev = d as Partial<Device>;
      const sub = parseSubscription(dev.sub);
      if (sub === null || typeof dev.owner !== "string") continue;
      this.devices.set(sub.endpoint, { owner: dev.owner, sub, hidden: dev.hidden === true, at: typeof dev.at === "number" ? dev.at : 0 });
    }
  }

  get enabled(): boolean {
    return this.sender !== null;
  }

  get publicKey(): string | null {
    return this.sender?.publicKey ?? null;
  }

  private persist(): void {
    this.init.save({ v: 1, devices: [...this.devices.values()] });
  }

  /** Bind a device to `owner` (moving it off anyone else), page visible.
   *  A repeat of the same binding only refreshes it in memory (no disk
   *  write — a looping client must not hammer `push.json`). False when
   *  the event is full (`MAX_DEVICES`) and this is a new device. */
  subscribe(owner: string, sub: PushSubscriptionJSON): boolean {
    const prev = this.devices.get(sub.endpoint);
    if (prev !== undefined && prev.owner === owner && prev.sub.keys.p256dh === sub.keys.p256dh && prev.sub.keys.auth === sub.keys.auth) {
      prev.hidden = false;
      prev.at = this.now();
      return true;
    }
    if (prev === undefined && this.devices.size >= MAX_DEVICES) return false;
    this.devices.delete(sub.endpoint);
    this.devices.set(sub.endpoint, { owner, sub, hidden: false, at: this.now() });
    const mine = [...this.devices.values()].filter((d) => d.owner === owner).sort((a, b) => a.at - b.at);
    for (const d of mine.slice(0, Math.max(0, mine.length - MAX_DEVICES_PER_OWNER))) this.devices.delete(d.sub.endpoint);
    this.persist();
    return true;
  }

  /** Forget one of `owner`'s devices. True when it was theirs. */
  unsubscribe(owner: string, endpoint: string): boolean {
    const d = this.devices.get(endpoint);
    if (d === undefined || d.owner !== owner) return false;
    this.devices.delete(endpoint);
    this.persist();
    return true;
  }

  /** The page on `endpoint` (or, with no endpoint, every device of
   *  `owner`) went hidden / visible. Returns how many devices it touched. */
  setHidden(owner: string, endpoint: string, hidden: boolean): number {
    let n = 0;
    for (const d of this.devices.values()) {
      if (d.owner !== owner || (endpoint !== "" && d.sub.endpoint !== endpoint)) continue;
      d.hidden = hidden;
      d.at = this.now();
      n++;
    }
    // Not persisted per flip (a beacon on every lock); a reboot defaults to
    // the saved flag, and the next flip corrects it.
    return n;
  }

  /** Owners with at least one device. */
  owners(): string[] {
    return [...new Set([...this.devices.values()].map((d) => d.owner))];
  }

  /** Drop every device whose owner matches (a restart, a released part). */
  drop(pred: (owner: string) => boolean): number {
    let n = 0;
    for (const [ep, d] of [...this.devices]) {
      if (!pred(d.owner)) continue;
      this.devices.delete(ep);
      n++;
    }
    if (n > 0) this.persist();
    return n;
  }

  /** Push to `owner`'s devices (only the hidden ones unless `always`). */
  notify(owner: string, payload: PushPayload, always: boolean): number {
    if (this.sender === null) return 0;
    const body = JSON.stringify(payload);
    let n = 0;
    for (const d of [...this.devices.values()]) {
      if (d.owner !== owner || (!always && !d.hidden)) continue;
      n++;
      const p = this.sender
        .send(d.sub, body, { ttl: TTL[payload.kind], urgency: "high" })
        .then((status) => {
          if (isDeadStatus(status)) {
            // The browser dropped the subscription (404 / 410), or the push
            // service refuses it outright (a junk key, a revoked VAPID
            // binding) — forget the device (unless it re-subscribed
            // meanwhile under the same endpoint).
            if (this.devices.get(d.sub.endpoint) === d) {
              this.devices.delete(d.sub.endpoint);
              this.persist();
            }
          } else if (status < 200 || status >= 300) {
            this.log(`  push: ${status || "network error"} for ${owner}\n`);
          }
        })
        .finally(() => this.inflight.delete(p));
      this.inflight.add(p);
    }
    return n;
  }

  /** Wait for every send in flight (tests, shutdown). */
  async settle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  /** Who is subscribed (the acceptance script, the director's checks). */
  status(): PushStatus {
    const by = new Map<string, { devices: number; hidden: number }>();
    for (const d of this.devices.values()) {
      const row = by.get(d.owner) ?? { devices: 0, hidden: 0 };
      row.devices++;
      if (d.hidden) row.hidden++;
      by.set(d.owner, row);
    }
    const guests: PushStatus["guests"] = [];
    const booths: PushStatus["booths"] = [];
    for (const [owner, row] of by) {
      if (owner.startsWith("guest:")) guests.push({ id: owner.slice(6), ...row });
      else if (owner.startsWith("prime:")) booths.push({ character: owner.slice(6), ...row });
    }
    return { enabled: this.enabled, guests, booths };
  }
}
