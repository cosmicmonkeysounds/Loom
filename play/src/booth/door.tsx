//! The door queue (wave 18, BOOTH-SPEC §4.4, Q26: Windows Defender is gone,
//! the four Antivirus share the door): who is waiting at the Optical Drive,
//! how long, and who has them; *🙋 Mine* claims one (A4), the foot scans
//! the next pass.

import { PersonAvatar } from "../ui/primitives.tsx";
import { BoothLayer } from "./layer.tsx";
import { mmss, type DoorEntry } from "./popouts/model.ts";

export function DoorWindow({ queue, now, me, canClaim, onClaim, onScan, onCard, onClose }: { queue: readonly DoorEntry[]; now: number; me: string; canClaim: boolean; onClaim: (e: DoorEntry) => void; onScan: (e: DoorEntry | null) => void; onCard: (id: string) => void; onClose: () => void }) {
  const next = queue.find((e) => e.claimedBy === null || e.claimedBy === me) ?? null;
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <span aria-hidden>🚪</span> At the door ({queue.length})
        </span>
      }
      label="At the door"
      onClose={onClose}
      foot={
        <button type="button" className="w95-btn booth-default door-next" onClick={() => onScan(next)}>
          📷 Scan the next pass
        </button>
      }
    >
      {queue.length === 0 ? (
        <p className="booth-none">Nobody is waiting at the door.</p>
      ) : (
        <ul className="rows-list">
          {queue.map((e) => (
            <li key={e.id} className="rows-row">
              <button type="button" className="rows-who" onClick={() => onCard(e.id)}>
                <PersonAvatar name={e.name} size="sm" />
                <span className="rows-name">{e.name}</span>
                <span className="rows-place">waiting {mmss(now - e.since)}</span>
              </button>
              <div className="rows-btns">
                {e.claimedBy !== null ? (
                  <span className="door-has">{e.claimedBy === me ? "🙋 You have them" : `${e.claimedBy} has them`}</span>
                ) : canClaim ? (
                  <button type="button" className="w95-btn rows-btn" onClick={() => onClaim(e)}>
                    🙋 Mine
                  </button>
                ) : (
                  <button type="button" className="w95-btn rows-btn" onClick={() => onScan(e)}>
                    📷 Scan
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </BoothLayer>
  );
}
