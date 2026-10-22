//! The voice stream (wave 19, §2.4): `GET /api/spatial/voice/stream?token=&spot=`
//! — one SSE stream per terminal (its path ends in `/stream`, so Caddy
//! neither gzips nor buffers it), carrying only the players the server says
//! this spot can hear, each with a gain:
//!
//!   hello  {codec, rate, chunkMs, as, spot, listen}  — on every (re)connect
//!   listen {on}                                       — whether anyone hears this room
//!   voice  {from, kind, name?, gain, seq, data}       — 200 ms of μ-law, base64
//!   bye    {from}                                     — that player went out of earshot
//!
//! Kept out of the spatial stream on purpose: every game and terminal holds
//! that one, and poses already flush on it at 10 Hz. Reconnects like it
//! (`world/stream.ts`): the browser retries a dropped connection itself; a
//! refusal is probed — 401 / 403 / 404 / 410 (access revoked, the voice link
//! off at this spot, no such spot, the event over) stops for good, anything
//! else retries with backoff.

import { VOICE_CODEC, VOICE_RATE } from "@loom/house";
import { retryDelay, type FeedSource } from "../world/stream.ts";

export type VoiceFrame =
  | { type: "hello"; codec: string; rate: number; listen: boolean; as: string; spot: string | null }
  | { type: "listen"; on: boolean }
  | { type: "voice"; from: string; kind: "terminal" | "player"; name: string | null; gain: number; seq: number; data: Uint8Array }
  | { type: "bye"; from: string };

export const VOICE_FRAME_NAMES = ["hello", "listen", "voice", "bye"] as const;

/** A base64 payload's bytes (null when it isn't base64). */
export function bytesOf(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** One SSE event off the voice stream; anything malformed or unknown is null. */
export function decodeVoiceFrame(event: string, data: string): VoiceFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  switch (event) {
    case "hello":
      return {
        type: "hello",
        codec: typeof r["codec"] === "string" ? r["codec"] : "",
        rate: typeof r["rate"] === "number" ? r["rate"] : 0,
        listen: r["listen"] === true,
        as: typeof r["as"] === "string" ? r["as"] : "",
        spot: typeof r["spot"] === "string" ? r["spot"] : null,
      };
    case "listen":
      return typeof r["on"] === "boolean" ? { type: "listen", on: r["on"] } : null;
    case "voice": {
      const from = r["from"];
      const gain = r["gain"];
      const seq = r["seq"];
      if (typeof from !== "string" || from === "" || typeof gain !== "number" || !Number.isFinite(gain) || typeof seq !== "number" || typeof r["data"] !== "string") return null;
      const bytes = bytesOf(r["data"]);
      if (bytes === null || bytes.length === 0) return null;
      return {
        type: "voice",
        from,
        kind: r["kind"] === "terminal" ? "terminal" : "player",
        name: typeof r["name"] === "string" && r["name"] !== "" ? r["name"] : null,
        gain: Math.max(0, Math.min(1, gain)),
        seq,
        data: bytes,
      };
    }
    case "bye":
      return typeof r["from"] === "string" && r["from"] !== "" ? { type: "bye", from: r["from"] } : null;
    default:
      return null;
  }
}

/** Whether a stream's hello speaks this client's wire (μ-law, 16 kHz). */
export function speaksOurWire(hello: Extract<VoiceFrame, { type: "hello" }>): boolean {
  return hello.codec === VOICE_CODEC && hello.rate === VOICE_RATE;
}

/** A refusal that ends the stream for good (else: retry). */
export function voiceGone(status: number | null): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

/** `EventSource.CLOSED` (not a global under node). */
const CLOSED = 2;

export interface VoiceStreamOptions {
  url: string;
  /** Ask the server why the stream was refused: the HTTP status, or null when unreachable. */
  probe: () => Promise<number | null>;
  onFrame: (f: VoiceFrame) => void;
  /** Open (true) / dropped (false): a dropped stream hears nobody and wants no mic. */
  onConnected: (on: boolean) => void;
  /** Refused for good (`voiceGone`). */
  onGone: (status: number) => void;
  source?: (url: string) => FeedSource;
}

/** Keep the voice stream open; returns the closer. */
export function openVoiceStream(opts: VoiceStreamOptions): () => void {
  const source = opts.source ?? ((url: string) => new EventSource(url) as FeedSource);
  let es: FeedSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let alive = true;
  const open = () => {
    const me = source(opts.url);
    es = me;
    me.onopen = () => {
      attempt = 0;
      opts.onConnected(true);
    };
    me.onerror = () => {
      if (!alive) return;
      opts.onConnected(false);
      if (me.readyState !== CLOSED) return; // the browser retries a drop itself
      me.close();
      void opts.probe().then((status) => {
        if (!alive) return;
        if (voiceGone(status)) {
          alive = false;
          opts.onGone(status!);
          return;
        }
        retry = setTimeout(open, retryDelay(attempt++));
      });
    };
    for (const event of VOICE_FRAME_NAMES) {
      me.addEventListener(event, (e) => {
        if (!alive) return;
        const f = decodeVoiceFrame(event, (e as MessageEvent<string>).data);
        if (f !== null) opts.onFrame(f);
      });
    }
  };
  open();
  return () => {
    alive = false;
    clearTimeout(retry);
    es?.close();
  };
}
