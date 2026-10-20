//! The chrome's icons (wave 13 fix round): small drawn Win95-style icons for
//! the parts of the frame the app draws itself — the taskbar's Start, Pass
//! and Scan, the tray's clock / balance / bell, the Start menu's own items —
//! in place of emoji (the craft floor: emoji are not an icon system). A 16 ×
//! 16 grid, a 1 px ink outline, flat fills from tokens (`chrome.css`), so
//! `plain` draws the same shapes in its own colours. Emoji the *story*
//! authors (a button's "🚻 Bathroom Mode", a cue's glyph) are content and
//! stay as written.
//!
//! The set is shared: the booth and the host draw their chrome from it too
//! (`Icon`, `IconName`, `ICON_NAMES` — e.g. the booth's 🧾 held transfers
//! → `receipt`, 🗂 Guests → `cards`, 🛡 → `shield`, 📓 → `codex`).

import type { ReactElement, ReactNode } from "react";

export type IconName =
  | "start"
  | "pass"
  | "scan"
  | "hourglass"
  | "pause"
  | "coin"
  | "frozen"
  | "bell"
  | "star"
  | "people"
  | "help"
  | "picture"
  | "screen-on"
  | "screen-off"
  | "defect"
  | "leave"
  | "pin"
  | "reply"
  | "codex"
  | "quest"
  | "receipt"
  | "cards"
  | "shield";

/** Every icon the chrome draws (tests walk the list). */
export const ICON_NAMES: readonly IconName[] = [
  "start",
  "pass",
  "scan",
  "hourglass",
  "pause",
  "coin",
  "frozen",
  "bell",
  "star",
  "people",
  "help",
  "picture",
  "screen-on",
  "screen-off",
  "defect",
  "leave",
  "pin",
  "reply",
  "codex",
  "quest",
  "receipt",
  "cards",
  "shield",
];

function shape(name: IconName): ReactElement {
  switch (name) {
    case "start":
      // the four-pane flag under aol97; a plain menu mark otherwise (no Win95 ornament)
      return (
        <>
          <g className="ico-flag">
            <path className="ico-red" d="M2 3.2 7 2.4v4.8H2Z" />
            <path className="ico-green" d="M8.2 2.2 14 1.4v5.8H8.2Z" />
            <path className="ico-blue" d="M2 8.4h5v4.8L2 12.4Z" />
            <path className="ico-yellow" d="M8.2 8.4H14v5.8l-5.8-.8Z" />
          </g>
          <path className="ico-menu ico-ink" d="M2 3h12v2H2ZM2 7h12v2H2ZM2 11h12v2H2Z" />
        </>
      );
    case "pass":
      // an admission ticket, notched at both ends, its stub dashed off
      return (
        <>
          <path className="ico-ticket ico-line" d="M1.5 4.5h13v2.2a1.4 1.4 0 0 0 0 2.6v2.2h-13V9.3a1.4 1.4 0 0 0 0-2.6Z" />
          <path className="ico-ink-line" d="M11 5.5v1M11 7.5v1M11 9.5v1" />
          <path className="ico-ink" d="M3.5 6.5h5v1h-5ZM3.5 8.5h4v1h-4Z" />
        </>
      );
    case "scan":
      // a camera: body, the viewfinder bump, the lens
      return (
        <>
          <path className="ico-face ico-line" d="M1.5 5.5h3l1-2h5l1 2h3v8h-13Z" />
          <circle className="ico-navy ico-line" cx="8" cy="9.4" r="2.8" />
          <rect className="ico-white" x="6.9" y="8.2" width="1.2" height="1.2" />
          <rect className="ico-ink" x="12" y="6.5" width="1.5" height="1" />
        </>
      );
    case "hourglass":
      return (
        <>
          <path className="ico-ink" d="M3 1.5h10v1.5H3ZM3 13h10v1.5H3Z" />
          <path className="ico-white ico-line" d="M4.5 3h7c0 2.6-2.6 3.6-2.6 5s2.6 2.4 2.6 5h-7c0-2.6 2.6-3.6 2.6-5S4.5 5.6 4.5 3Z" />
          <path className="ico-sand" d="M6 12.4h4c-.4-1.4-1.6-2-2-2.6-.4.6-1.6 1.2-2 2.6ZM6.2 4.4h3.6C9.5 5.4 8.6 6 8 6.6 7.4 6 6.5 5.4 6.2 4.4Z" />
        </>
      );
    case "pause":
      return (
        <>
          <rect className="ico-face ico-line" x="3.5" y="2.5" width="3" height="11" />
          <rect className="ico-face ico-line" x="9.5" y="2.5" width="3" height="11" />
        </>
      );
    case "coin":
      return (
        <>
          <circle className="ico-gold ico-line" cx="8" cy="8" r="6.3" />
          <circle className="ico-gold-hi ico-line" cx="8" cy="8" r="3.8" />
          <path className="ico-ink" d="M6.3 6h3.4v1H8.5v3.2h-1V7H6.3Z" />
        </>
      );
    case "frozen":
      return <path className="ico-ink-line ico-frost" d="M8 1.5v13M2.4 4.8l11.2 6.4M2.4 11.2l11.2-6.4M6.4 2.6 8 4.2l1.6-1.6M6.4 13.4 8 11.8l1.6 1.6" />;
    case "bell":
      return (
        <>
          <path className="ico-yellow ico-line" d="M8 2c2.6 0 4 1.9 4 4.4v3l1.6 2.1H2.4L4 9.4v-3C4 3.9 5.4 2 8 2Z" />
          <path className="ico-ink" d="M6.5 12.5h3a1.5 1.5 0 0 1-3 0Z" />
          <rect className="ico-ink" x="7.4" y="0.8" width="1.2" height="1.4" />
        </>
      );
    case "star":
      return <path className="ico-yellow ico-line" d="m8 1.5 1.9 4.2 4.6.5-3.4 3.1 1 4.5L8 11.5l-4.1 2.3 1-4.5L1.5 6.2l4.6-.5Z" />;
    case "people":
      return (
        <>
          <circle className="ico-skin ico-line" cx="5.5" cy="5" r="2.3" />
          <path className="ico-blue ico-line" d="M1.5 13.5c0-3 1.8-4.6 4-4.6s4 1.6 4 4.6Z" />
          <circle className="ico-skin ico-line" cx="11" cy="5.6" r="2" />
          <path className="ico-green ico-line" d="M10.4 13.5h4.1c0-2.8-1.5-4.3-3.5-4.3-.6 0-1.2.1-1.6.4.6.9 1 2.2 1 3.9Z" />
        </>
      );
    case "help":
      return (
        <>
          <circle className="ico-navy ico-line" cx="8" cy="8" r="6.4" />
          <path className="ico-white" d="M6 6.3C6 5 6.9 4.2 8.1 4.2c1.3 0 2.1.8 2.1 1.9 0 1.6-1.6 1.7-1.6 3.1H7.3c0-1.9 1.6-2.1 1.6-3 0-.5-.3-.8-.8-.8-.6 0-.9.4-.9.9ZM7.3 10.2h1.4v1.5H7.3Z" />
        </>
      );
    case "picture":
      return (
        <>
          <rect className="ico-white ico-line" x="1.5" y="2.5" width="13" height="11" />
          <path className="ico-green" d="M2.5 12.5 6.5 7l2.6 3.4L11 8.6l2.5 3.9Z" />
          <circle className="ico-yellow" cx="11.4" cy="5.2" r="1.4" />
        </>
      );
    case "screen-on":
    case "screen-off":
      return (
        <>
          <rect className="ico-face ico-line" x="1.5" y="1.5" width="13" height="10" />
          <rect className={name === "screen-on" ? "ico-screen" : "ico-ink"} x="3" y="3" width="10" height="7" />
          <path className="ico-face ico-line" d="M5.5 11.5h5l1 3h-7Z" />
          {name === "screen-on" && <path className="ico-white" d="M4 4h3v1H5v2H4Z" />}
        </>
      );
    case "defect":
      return (
        <>
          <path className="ico-navy ico-line" d="M1.5 4.5h8V2.5l4 3.5-4 3.5v-2h-8Z" />
          <path className="ico-face ico-line" d="M14.5 11.5h-8v2l-4-3.5 4-3.5v2h8Z" />
        </>
      );
    case "leave":
      return (
        <>
          <rect className="ico-face ico-line" x="2.5" y="1.5" width="8" height="13" />
          <path className="ico-door ico-line" d="M2.5 1.5 7.5 3v12.5l-5-1Z" />
          <rect className="ico-ink" x="6" y="8" width="1" height="1.4" />
          <path className="ico-red ico-line" d="M10.5 7h2V5.2l2.3 2.8-2.3 2.8V9h-2Z" />
        </>
      );
    case "pin":
      // a pushpin: the red head, its collar, the needle
      return (
        <>
          <path className="ico-red ico-line" d="M5.5 1.5h5l-.8 3.6 2.3 2.4H4l2.3-2.4Z" />
          <path className="ico-ink-line" d="M8 7.8v6.7" />
        </>
      );
    case "reply":
      // a speech bubble with its tail, three dots in it
      return (
        <>
          <path className="ico-white ico-line" d="M1.5 2.5h13v8.5H7.2l-3.4 3v-3H1.5Z" />
          <path className="ico-ink" d="M4.5 6h1.5v1.5H4.5ZM7.25 6h1.5v1.5h-1.5ZM10 6h1.5v1.5H10Z" />
        </>
      );
    case "codex":
      // a bound book: the navy cover, the page edge, a title label
      return (
        <>
          <path className="ico-white ico-line" d="M3.5 12.5h10v2h-10a1 1 0 0 1 0-2Z" />
          <path className="ico-navy ico-line" d="M3.5 1.5h10v11h-10a1.5 1.5 0 0 0-1.5 1.5V3a1.5 1.5 0 0 1 1.5-1.5Z" />
          <rect className="ico-white" x="6" y="4" width="5" height="2" />
        </>
      );
    case "quest":
      // a scroll: the sheet, a roll at each end, its lines
      return (
        <>
          <path className="ico-white ico-line" d="M3.5 3.5h9v9h-9Z" />
          <rect className="ico-sand ico-line" x="2" y="1.5" width="12" height="2.5" rx="1.2" />
          <rect className="ico-sand ico-line" x="2" y="12" width="12" height="2.5" rx="1.2" />
          <path className="ico-ink" d="M5 6h6v1H5ZM5 8.5h5v1H5Z" />
        </>
      );
    case "receipt":
      // a till receipt: a torn foot, its lines, the total
      return (
        <>
          <path className="ico-white ico-line" d="M3.5 1.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1Z" />
          <path className="ico-ink" d="M5 4h6v1H5ZM5 6.5h6v1H5ZM5 9h3v1H5ZM9.5 9H11v1H9.5Z" />
        </>
      );
    case "cards":
      // a card file: two index cards, the front one with its tab
      return (
        <>
          <path className="ico-face ico-line" d="M3.5 2.5h10v8h-10Z" />
          <path className="ico-white ico-line" d="M1.5 5.5h4l1 1.5h6v7h-11Z" />
          <path className="ico-ink" d="M3.5 9.5h7v1h-7ZM3.5 11.5h5v1h-5Z" />
        </>
      );
    case "shield":
      // an antivirus shield: the navy face, its white check
      return (
        <>
          <path className="ico-navy ico-line" d="M8 1.5 13.5 3.5v4c0 3.4-2.3 5.8-5.5 7-3.2-1.2-5.5-3.6-5.5-7v-4Z" />
          <path className="ico-white" d="m5.2 7.8 1.1-1.1 1.3 1.3 3-3 1.1 1.1-4.1 4.1Z" />
        </>
      );
  }
}

/** A caption with its icon in front ("🔔 Alerts" drawn): a sheet's or a balloon's title. */
export function IconTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="ico-title">
      <Icon name={icon} />
      <span>{children}</span>
    </span>
  );
}

/** One chrome icon, decorative (its button carries the name). */
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`ico ico-${name}${className !== undefined ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {shape(name)}
    </svg>
  );
}
