//! The full-screen pass (wave 13; the chrome lane makes it full-screen):
//! the QR a performer scans, for the guest's 🎟 Pass and the cutscene's
//! "My pass". Stage A: exactly today's pass sheet.

import { PassQr } from "../pass-qr.tsx";
import { Sheet } from "../ui/primitives.tsx";

export function FullPass({ guestId, name, onClose }: { guestId: string; name: string; onClose: () => void }) {
  return (
    <Sheet title="🎟️ Your pass" onClose={onClose}>
      <div className="pass">
        <PassQr alt="QR" text={guestId} />
        <div className="bigid">{guestId}</div>
        <div className="muted">{name} · show this to a performer to be scanned.</div>
      </div>
    </Sheet>
  );
}
