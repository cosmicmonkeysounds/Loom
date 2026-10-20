//! The alert banner (moved out of `chat.tsx` in wave 13). Kept for the
//! barrel (`chat.tsx` re-exports it); the moments layer renders alarms on
//! the interrupt ladder now (`surfaces.tsx` `StickyBanner` is its sticky rung).

import { Icon } from "../chrome/icons.tsx";

/** A one-line alarm bar with a dismiss — the pre-wave-13 banner. */
export function AlertBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="alert-banner" role="alert" onClick={onDismiss}>
      <span className="alert-glyph" aria-hidden>
        <Icon name="bell" />
      </span>
      <span className="alert-text">{text}</span>
      <button className="alert-x" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
