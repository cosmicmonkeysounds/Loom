//! The alert banner (moved out of `chat.tsx` in wave 13).

/** The alert banner — a broadcast the story wants you to *act* on. */
export function AlertBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="alert-banner" role="alert" onClick={onDismiss}>
      <span className="alert-glyph" aria-hidden>
        🔔
      </span>
      <span className="alert-text">{text}</span>
      <button className="alert-x" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
