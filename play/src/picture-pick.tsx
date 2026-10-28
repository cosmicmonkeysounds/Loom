//! Choosing a profile picture: a grid of a program's picture options.
//!
//! Wikipedia's lead image for a piece of software is often a screenshot
//! rather than the picture everybody knows it by, so a guest picks: the
//! story's hand-picked pictures come first, then the article's logos, box
//! art and screenshots. Used at sign-in (after picking a program) and from
//! the guest's pass sheet (switching later).

import { avatarUrl, pictureGaveUp, pictureUrl, type PictureChoice } from "./avatars.ts";
import { usePictureTries } from "./ui/primitives.tsx";

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
        <PictureOption key={o.key} eventId={eventId} option={o} index={i} on={selected === o.key} onSelect={onSelect} disabled={disabled} />
      ))}
    </div>
  );
}

/** One choice. A picture that won't load after its retries isn't a choice
 *  (gone from the grid); while a retry waits, the tile stays, empty. */
function PictureOption({ eventId, option: o, index: i, on, onSelect, disabled }: { eventId: string; option: PictureChoice; index: number; on: boolean; onSelect: (key: string) => void; disabled: boolean }) {
  const [tries, failed] = usePictureTries();
  if (pictureGaveUp(tries)) return null;
  const url = pictureUrl(avatarUrl(eventId, o.key), tries);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={o.file !== "" ? o.file : `Picture ${i + 1}`}
      title={o.file !== "" ? o.file : undefined}
      className={`picture-opt ${on ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onSelect(o.key)}
    >
      {url !== null && <img src={url} alt="" decoding="async" draggable={false} onError={failed} />}
    </button>
  );
}
