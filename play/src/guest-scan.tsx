//! The guest's own 📷 Scan (W11, W-13). The walls carry the codex QRs
//! (`…/?code=<event>&unlock=<code>` — the door code's four digit clues
//! among them) and the room check-in signs (`…&checkin=<room>`, K-13).
//! Scanned with the phone's camera app, each one opens a new tab — or a
//! different browser with no session, where a tipsy guest joins again as a
//! ghost program. Scanned here, in the app, the code lands in the session
//! already open: an `unlock=` redeems through `/api/guest/codex/redeem`, a
//! `checkin=` checks in through `/api/guest/checkin`, and anything else
//! (the join QR, your own pass, an invitation) just says what it is, and
//! someone else's pass opens the Recruit sheet (wave 18).
//!
//! And the other half: a codex / check-in link that arrives in a browser
//! with **no** session (`LinkLanding`) shows the code in big type — "type
//! it into your Codex in the app you joined with" — never the program
//! picker; joining is the secondary path.
//!
//! The pure classifiers are unit-tested in `test/guest-scan.test.tsx`; the
//! camera is `scanner.tsx`'s, the booth's.

import { useEffect, useRef, useState } from "react";
import { useBigOnScreen, useMomentsHold } from "./moments/provider.tsx";
import { checkinFromSearch } from "./checkin.ts";
import { unlockFromSearch } from "./codex.ts";
import { badgeFromText } from "./rejoin.ts";
import type { CameraState } from "./scan.ts";
import { CameraScanner } from "./scanner.tsx";

/** What a guest's scan does. */
export type GuestScan =
  /** A codex code: redeem it. */
  | { kind: "unlock"; code: string }
  /** A room's sign: check in there (the room's slug, as the sign carries it). */
  | { kind: "checkin"; at: string }
  /** Another guest's pass (wave 18, F3): the Recruit sheet. */
  | { kind: "pass"; id: string }
  /** A printed badge (wave 23): yours links to you; someone else's is their pass. */
  | { kind: "badge"; badge: string }
  /** Anything else: say what it is, and keep the camera on. */
  | { kind: "note"; text: string };

/** A guest / persona id as the server mints them (a pass QR). */
const GUEST_ID = /^[gp]-[0-9a-f]{6}$/i;
/** A bare code printed as a QR of its own text (no link): redeem it. */
const BARE_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;

export const SCAN_JOIN = "That's the party's join code — you're already in.";
export const SCAN_INVITE = "That's an invitation link — you're already in.";
export const SCAN_PAIR = "That's a director's re-pair code — it signs a phone in as someone. Only open it with your camera if a director handed it to you.";
export const SCAN_OWN_PASS = "That's your own pass — performers scan it, not you.";
export const SCAN_DIRECTOR = "That's the director's page — not for guests.";
export const SCAN_UNKNOWN = "That QR isn't one of the party's codes.";

/** A pass: your own says so; anyone else's opens the Recruit sheet (wave 18). */
function passScan(id: string, meId: string | null): GuestScan {
  return id.toLowerCase() === meId?.toLowerCase() ? { kind: "note", text: SCAN_OWN_PASS } : { kind: "pass", id: id.toLowerCase() };
}

/** Classify a scanned QR for a signed-in guest (`meId`: their own id). */
export function guestScan(raw: string, meId: string | null = null): GuestScan {
  const text = raw.trim();
  if (text === "") return { kind: "note", text: SCAN_UNKNOWN };
  if (GUEST_ID.test(text)) return passScan(text, meId);
  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (url === null) return BARE_CODE.test(text) ? { kind: "unlock", code: text } : { kind: "note", text: SCAN_UNKNOWN };
  const unlock = unlockFromSearch(url.search);
  if (unlock !== null) return { kind: "unlock", code: unlock };
  const checkin = checkinFromSearch(url.search);
  if (checkin !== null) return { kind: "checkin", at: checkin };
  const p = url.searchParams;
  if ((p.get("pair") ?? "").trim() !== "") return { kind: "note", text: SCAN_PAIR };
  const badge = badgeFromText(p.get("badge") ?? "");
  if (badge !== null) return { kind: "badge", badge };
  const pass = p.get("pass") ?? p.get("guest");
  if (pass !== null && GUEST_ID.test(pass)) return passScan(pass, meId);
  if (p.get("role") === "director") return { kind: "note", text: SCAN_DIRECTOR };
  if ((p.get("claim") ?? "").trim() !== "") return { kind: "note", text: SCAN_INVITE };
  if (p.has("code")) return { kind: "note", text: SCAN_JOIN };
  return { kind: "note", text: SCAN_UNKNOWN };
}

/** Why a guest's camera isn't running, and what to do instead. */
export function guestCameraProblem(state: CameraState): string | null {
  switch (state) {
    case "insecure":
      return "The camera needs a secure address (https://) — type the code below instead.";
    case "denied":
      return "Camera permission was refused — allow it in Settings › Safari › Camera (or the browser's site settings), then try again. Meanwhile type the code below.";
    case "none":
      return "No camera on this device — type the code below.";
    case "error":
      return "The camera couldn't start — type the code below.";
    default:
      return null;
  }
}

/** The scan sheet's hint while the camera runs. */
export const SCAN_HINT = "Point it at a code on the wall. Scanning here keeps you signed in — never use the phone's camera app.";

/** What the typed box says when the text is no code at all. */
export const TYPED_UNKNOWN = "That isn't a code — check the sign and type it again.";

/** Fold a room's name or a typed word for comparing: case, spaces, `-` and
 *  `_` and punctuation all drop (`The Desktop (living room)` → its id's
 *  `thedesktop` once the label in brackets is gone). */
function foldRoom(s: string): string {
  return s
    .replace(/\([^)]*\)/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** A room the typed box can check into: its `loc:` id and its title. */
export interface ScanRoom {
  id: string;
  title: string;
}

/**
 * What a code typed into the scan sheet does (pure — `test/guest-scan.test.tsx`):
 * a whole link reads like a scan; a room the guest can see (its name or its
 * sign's slug, `the-desktop`) checks in there; anything else that looks like
 * a code redeems it in the Codex.
 */
export function typedScan(raw: string, rooms: readonly ScanRoom[] = [], meId: string | null = null): GuestScan {
  const text = raw.trim();
  if (text === "") return { kind: "note", text: TYPED_UNKNOWN };
  if (/^https?:\/\//iu.test(text)) return guestScan(text, meId);
  const key = foldRoom(text);
  if (key !== "") {
    for (const r of rooms) {
      const id = r.id.startsWith("loc:") ? r.id.slice(4) : r.id;
      if (foldRoom(id) === key || foldRoom(r.title) === key) return { kind: "checkin", at: id };
    }
  }
  if (GUEST_ID.test(text)) return guestScan(text, meId);
  return BARE_CODE.test(text) ? { kind: "unlock", code: text } : { kind: "note", text: TYPED_UNKNOWN };
}

/**
 * The 📷 Scan layer: the camera, reading continuously, and a box to type
 * the code into when the camera can't (or a sign is hard to read). A codex
 * code or a room's sign is handed to `onScan` (redeem / check in), which
 * resolves to null once done (the sheet closes and the app shows where it
 * landed) or to a line to show; anything else is said and the camera stays
 * on. It sits over everything but a takeover (`--z-pass`), and holds the
 * interrupt ladder's dialogs back while it is open.
 */
export function ScanSheet({
  meId,
  onScan,
  onClose,
  rooms,
}: {
  meId: string | null;
  onScan: (scan: Exclude<GuestScan, { kind: "note" }>) => Promise<string | null>;
  onClose: () => void;
  /** The rooms the guest can see, so a typed room name checks in. */
  rooms?: readonly ScanRoom[];
}) {
  useMomentsHold(true);
  const [cam, setCam] = useState<CameraState>("off");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const busy = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  // A big moment that waited out its hold covers the sheet: the camera and
  // its decode loop stop with it (OD-F5: a code read behind the big acted
  // unseen, and jsQR kept an old phone busy).
  const bigUp = useBigOnScreen();
  useEffect(() => {
    if (bigUp) close.current();
  }, [bigUp]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const problem = guestCameraProblem(cam);
  const run = (hit: GuestScan, then?: () => void) => {
    if (busy.current) return;
    if (hit.kind === "note") return setNote(hit.text);
    busy.current = true;
    setNote(hit.kind === "unlock" ? "🔓 Unlocking…" : hit.kind === "pass" ? "🎟 Reading the pass…" : hit.kind === "badge" ? "🪪 Reading the badge…" : "📍 Checking in…");
    void onScan(hit).then(
      (said) => {
        busy.current = false;
        then?.();
        if (said === null) onClose();
        else setNote(said);
      },
      () => {
        busy.current = false;
        setNote("⚠️ That didn't go through — check your connection and try again.");
      },
    );
  };
  const onCode = (raw: string) => run(guestScan(raw, meId));
  const submit = () => run(typedScan(typed, rooms, meId), () => setTyped(""));
  return (
    <div className="scan-layer" role="dialog" aria-modal="true" aria-label="Scan a code">
      <div className="w95-window scan-window">
        <div className="w95-titlebar">
          <span className="w95-title">📷 Scan a code</span>
          <button type="button" className="w95-btn w95-x" aria-label="Close the scanner" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="scan-body">
          {!problem && <CameraScanner onCode={onCode} onState={setCam} />}
          {!problem && <div className="scan-hint">{cam === "live" ? SCAN_HINT : "Starting the camera…"}</div>}
          {problem && <div className="err scan-problem">{problem}</div>}
          {note && (
            <div className="scan-note" role="status">
              {note}
            </div>
          )}
          <form
            className="scan-typed"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="scan-typed-label" htmlFor="scan-typed-input">
              Or type the code
            </label>
            <div className="scan-typed-row">
              <input
                id="scan-typed-input"
                className="scan-typed-input"
                value={typed}
                placeholder="A code, or a room's name"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
                onChange={(e) => setTyped(e.target.value)}
              />
              <button type="submit" className="w95-btn scan-typed-go" disabled={typed.trim() === ""}>
                Enter
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// --- the wrong-browser landing ---------------------------------------------

/** A codex / check-in link that opened with no session. */
export type LandingLink = { kind: "unlock"; code: string } | { kind: "checkin"; at: string; room: string };

/** The link a session-less page came in on (`?unlock=` wins), or null. */
export function landingLink(search: string): LandingLink | null {
  const code = unlockFromSearch(search);
  if (code !== null) return { kind: "unlock", code };
  const at = checkinFromSearch(search);
  if (at !== null) return { kind: "checkin", at, room: roomFromSlug(at) };
  return null;
}

/** The computer words a room name spells in capitals (`the-cpu` is the
 *  show's `The CPU`, `the-ram` its `The RAM`): the slug is lower-cased, so
 *  title-casing alone would sign them "The Cpu" / "The Ram". */
const ACRONYMS: ReadonlySet<string> = new Set([
  "ai", "aol", "bios", "cd", "cpu", "crt", "dns", "dos", "dvd", "gpu", "hdd", "html", "http", "io", "ip", "irc", "isp",
  "lan", "led", "msn", "os", "pc", "ram", "rom", "ssd", "tv", "url", "usb", "vga", "vr", "wifi", "www", "y2k",
]);

/** A sign's slug as the room's name: `the-start-bar` → `The Start Bar`,
 *  `the-cpu` → `The CPU` (the server folds the slug onto the declared
 *  LOCATION; the landing has no session to ask, so it reads the sign's own
 *  words). */
export function roomFromSlug(slug: string): string {
  let s = slug;
  try {
    s = decodeURIComponent(slug);
  } catch {
    /* keep it as it came */
  }
  return s
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

/** What the landing says after a cut session: join again, the link waits. */
export function rejoinLine(link: LandingLink): string {
  return link.kind === "unlock" ? `Join again — ${link.code} goes into your Codex once you're in.` : `Join again — you'll be checked into ${link.room} once you're in.`;
}

/** The landing's headline for a codex link. */
export function landingTypeLine(code: string): string {
  return `Type ${code} into your Codex in the app you joined with.`;
}

/**
 * The page a wall QR opens in a browser that isn't the guest's (a QR app's
 * webview, another browser, a Home Screen install with its own storage):
 * the code in big type to type in the app they joined with, or the room a
 * sign is for — never the program picker. "I haven't joined yet" is the
 * secondary path (the link stays, so the code still redeems once in).
 */
export function LinkLanding({ link, title, notice, onJoin, onPerformer }: { link: LandingLink; title: string | null; notice?: string | null; onJoin: () => void; onPerformer?: () => void }) {
  // A session in *this* browser was just cut (a restart, the event ended):
  // it is the right browser, so say why and lead with joining again — the
  // link stays, so the code still redeems (the sign still checks in) once in.
  if (notice) {
    return (
      <div className="hero landing">
        <div className="glyph">{link.kind === "unlock" ? "📓" : "📍"}</div>
        {title && <h1>{title}</h1>}
        <p className="notice">{notice}</p>
        <p className="landing-say">{rejoinLine(link)}</p>
        <button className="choice primary" onClick={onJoin}>
          Join again →
        </button>
        {onPerformer && (
          <button className="link" onClick={onPerformer}>
            I'm a performer
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="hero landing">
      <div className="glyph">{link.kind === "unlock" ? "📓" : "📍"}</div>
      {title && <h1>{title}</h1>}
      {link.kind === "unlock" ? (
        <>
          <p className="sub">You scanned a Codex code — but this browser isn't the one you joined in.</p>
          <div className="landing-code" aria-label="The code">
            {link.code}
          </div>
          <p className="landing-say">{landingTypeLine(link.code)}</p>
        </>
      ) : (
        <>
          <p className="sub">You scanned the sign for</p>
          <div className="landing-code room" aria-label="The room">
            {link.room}
          </div>
          <p className="landing-say">Open the app you joined with, tap 📷 Scan and point it at this sign to check in.</p>
        </>
      )}
      <p className="muted">Next time, scan with the 📷 button inside the app, not the phone's camera — it keeps you in.</p>
      <button className="choice ghost" onClick={onJoin}>
        I haven't joined yet → Join
      </button>
      {onPerformer && (
        <button className="link" onClick={onPerformer}>
          I'm a performer
        </button>
      )}
    </div>
  );
}
