// The guest's own 📷 Scan (W11, W-13). The walls carry the codex QRs
// (`…/?code=<event>&unlock=<code>` — the door code's four digit clues
// among them) and the room check-in signs (`…&checkin=<room>`, K-13).
// Scanned with the phone's camera app, each one opens a new tab — or a
// different browser with no session, where a tipsy guest joins again as a
// ghost program. Scanned here, in the app, the code lands in the session
// already open: an `unlock=` redeems through `/api/guest/codex/redeem`, a
// `checkin=` checks in through `/api/guest/checkin`, and anything else
// (the join QR, your own pass, an invitation) just says what it is, and
// someone else's pass opens the Recruit sheet (wave 18).
//
// And the other half: a codex / check-in link that arrives in a browser
// with **no** session (`LinkLanding`) shows the code in big type — "type
// it into your Codex in the app you joined with" — never the program
// picker; joining is the secondary path.
//
// The pure classifiers are unit-tested in `test/guest-scan.test.tsx`; the
// camera is `scanner.tsx`'s, the booth's.
//
// Wave 26: the 📷 Scan sheet and its classifiers moved to
// `guest-scan-sheet.tsx` (a lazy chunk); this file keeps the landing.

import { actFromSearch } from "./act-link.ts";
import { checkinFromSearch } from "./checkin.ts";
import { unlockFromSearch } from "./codex.ts";

// --- the wrong-browser landing ---------------------------------------------

/** A codex / check-in link that opened with no session. */
export type LandingLink = { kind: "unlock"; code: string } | { kind: "checkin"; at: string; room: string } | { kind: "act" };

/** The link a session-less page came in on (`?unlock=` wins), or null. */
export function landingLink(search: string): LandingLink | null {
  const code = unlockFromSearch(search);
  if (code !== null) return { kind: "unlock", code };
  const at = checkinFromSearch(search);
  if (at !== null) return { kind: "checkin", at, room: roomFromSlug(at) };
  return actFromSearch(search) !== null ? { kind: "act" } : null;
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
  if (link.kind === "act") return "Join again — this sign works once you're in.";
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
      ) : link.kind === "act" ? (
        <p className="landing-say">You scanned a sign, but this browser isn't the one you joined in. Open the app you joined with, tap 📷 Scan and point it at this sign.</p>
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
