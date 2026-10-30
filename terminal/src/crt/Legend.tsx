//! The CRT's bottom line (wave 52b): the buttons that work right now
//! (`legend.ts`). Y has no place in the choices, so its hint is the button the
//! controller's Y presses (`data-pad-y`), and holding Start the same (`data-pad-hold`).

import type { Legend } from "./legend.ts";

export function CrtLegend({ legend, onGive, onHold }: { legend: Legend; onGive: () => void; onHold: () => void }) {
  return (
    <footer className="crt-legend">
      {legend.note !== null && <span className="crt-legend-note">{legend.note}</span>}
      {legend.hints.map((h) =>
        h.file === true || h.hold === true ? (
          <button type="button" key={h.key} className="crt-hint" data-pad-y={h.file === true ? "" : undefined} data-pad-hold={h.hold === true ? "" : undefined} onClick={h.file === true ? onGive : onHold}>
            <kbd>{h.key}</kbd>
            {h.label}
          </button>
        ) : (
          <span key={h.key} className="crt-hint">
            <kbd>{h.key}</kbd>
            {h.label}
          </span>
        ),
      )}
    </footer>
  );
}
