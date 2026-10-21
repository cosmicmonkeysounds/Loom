//! The 🔔 Waiting window (wave 18, BOOTH-SPEC §4.13): every pop-out deferred
//! with *Later*, newest first; a tap brings it back on screen.

import { BoothLayer } from "./layer.tsx";
import { PopOutTrayList, usePopOuts } from "./popouts/rung.ts";

export function WaitingWindow({ onClose }: { onClose: () => void }) {
  const { tray } = usePopOuts();
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <span aria-hidden>🔔</span> Waiting ({tray.length})
        </span>
      }
      label="Waiting"
      onClose={onClose}
      dock={false}
    >
      <PopOutTrayList onPick={onClose} />
    </BoothLayer>
  );
}
