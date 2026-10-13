//! Choosing a profile picture: a grid of a program's picture options.
//!
//! Wikipedia's lead image for a piece of software is often a screenshot
//! rather than the picture everybody knows it by, so a guest picks: the
//! story's hand-picked pictures come first, then the article's logos, box
//! art and screenshots. Used at sign-in (after picking a program) and from
//! the guest's pass sheet (switching later).

import { avatarUrl, type PictureChoice } from "./avatars.ts";

export function PictureGrid({
  eventId,
  options,
  selected,
  onSelect,
  disabled = false,
}: {
  eventId: string;
  options: readonly PictureChoice[];
  selected: string | null;
  onSelect: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="picture-grid" role="radiogroup" aria-label="Profile picture">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={selected === o.key}
          aria-label={o.file !== "" ? o.file : `Picture ${i + 1}`}
          title={o.file !== "" ? o.file : undefined}
          className={`picture-opt ${selected === o.key ? "on" : ""}`}
          disabled={disabled}
          onClick={() => onSelect(o.key)}
        >
          <img src={avatarUrl(eventId, o.key)} alt="" loading="lazy" draggable={false} onError={(e) => {
              // a picture that won't load isn't a choice (hidden, not removed: React owns the node)
              const b = e.currentTarget.closest("button");
              if (b !== null) b.style.display = "none";
            }} />
        </button>
      ))}
    </div>
  );
}
