//! The booth's own drawn icons (wave 13 recheck): the few the chrome's set
//! (`chrome/icons.tsx`) has no shape for — a guest's card, a message, the
//! character's lore, a re-scan, the receipt of held transfers, moderator
//! powers and the Win95 warning sign on a press that marks or captures.
//! Same grid and classes as the chrome's (16 × 16, a 1 px ink line, flat
//! fills from the `chrome.css` tokens), so `plain` draws them in its own
//! colours. The chrome's icons (Scan, Guests, the clock, help, the bell,
//! the screen, leave) come from `chrome/icons.tsx` itself.

import type { ReactElement, ReactNode } from "react";

export type BoothIconName = "card" | "message" | "lore" | "rescan" | "receipt" | "powers" | "warning";

/** Every booth icon (tests walk the list). */
export const BOOTH_ICON_NAMES: readonly BoothIconName[] = ["card", "message", "lore", "rescan", "receipt", "powers", "warning"];

function shape(name: BoothIconName): ReactElement {
  switch (name) {
    case "card":
      // an ID card: a photo square and two lines of text
      return (
        <>
          <rect className="ico-white ico-line" x="1.5" y="3.5" width="13" height="9" />
          <rect className="ico-skin ico-line" x="3" y="5.5" width="4" height="5" />
          <path className="ico-ink" d="M8.5 6h4.5v1H8.5ZM8.5 8.5h3.5v1H8.5Z" />
        </>
      );
    case "message":
      // a speech balloon with three dots
      return (
        <>
          <path className="ico-white ico-line" d="M2 3.5h12v7.5H7l-3 2.5v-2.5H2Z" />
          <path className="ico-ink" d="M4.5 6.6h1.4V8H4.5ZM7.3 6.6h1.4V8H7.3ZM10.1 6.6h1.4V8h-1.4Z" />
        </>
      );
    case "lore":
      // a closed book, its spine dark, a page edge showing
      return (
        <>
          <path className="ico-blue ico-line" d="M3.5 1.5h9v11h-9Z" />
          <path className="ico-white ico-line" d="M3.5 12.5h9v2h-9Z" />
          <path className="ico-navy" d="M3.5 1.5h2v11h-2Z" />
          <path className="ico-yellow" d="M7 4.5h4v1.2H7Z" />
        </>
      );
    case "rescan":
      // the scanner's beam: a dish and three arcs
      return (
        <>
          <path className="ico-face ico-line" d="M2 13.5 5 7.5l4 4Z" />
          <path className="ico-ink-line" d="M6.5 6a3 3 0 0 1 3.5 3.5M7 3.5a5.5 5.5 0 0 1 5.5 5.5M7.5 1a8 8 0 0 1 7.5 7.5" />
        </>
      );
    case "receipt":
      // a till receipt, its torn foot zigzagged
      return (
        <>
          <path className="ico-white ico-line" d="M3.5 1.5h9v12l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1Z" />
          <path className="ico-ink" d="M5 4h6v1H5ZM5 6.5h6v1H5ZM5 9h4v1H5Z" />
        </>
      );
    case "powers":
      // a shield: the moderator's badge
      return (
        <>
          <path className="ico-navy ico-line" d="M8 1.5 13.5 3.5v4c0 3.4-2.3 5.6-5.5 7-3.2-1.4-5.5-3.6-5.5-7v-4Z" />
          <path className="ico-yellow" d="M7.4 4h1.2v3.4H12v1.2H8.6V12H7.4V8.6H4V7.4h3.4Z" />
        </>
      );
    case "warning":
      // Win95's exclamation: a yellow triangle, a black stroke and dot
      return (
        <>
          <path className="ico-yellow ico-line" d="M8 1.5 15 14H1Z" />
          <path className="ico-ink" d="M7.2 5.5h1.6l-.3 5H7.5ZM7.2 11.4h1.6v1.5H7.2Z" />
        </>
      );
  }
}

/** One booth icon, decorative (its button carries the name). */
export function BoothIcon({ name, size = 16, className }: { name: BoothIconName; size?: number; className?: string }) {
  return (
    <svg className={`ico ico-${name}${className !== undefined ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {shape(name)}
    </svg>
  );
}

/** A label with its icon in front (a utility button, a window caption). */
export function WithIcon({ icon, children }: { icon: ReactElement; children: ReactNode }) {
  return (
    <span className="booth-with-icon">
      {icon}
      <span>{children}</span>
    </span>
  );
}
