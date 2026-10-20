//! The booth's scanner (wave 13): the taskbar's 📷 Scan opens it with the
//! camera already on and a typed-id box under it. A pass the camera reads
//! (or an id typed) is scanned at once and that guest's card opens in its
//! place — the story's reply on it, the buttons that matter now on its
//! face. "📷 Next guest" (or closing the card) brings the live camera back,
//! so a door queue goes pass after pass. The camera is off while a card
//! sits over it, and the pass that was just closed is ignored for a moment
//! (`closedGate`), so closing a card never re-opens it.

import { useMemo, useState } from "react";
import type { PrimeSession } from "../session/prime.ts";
import { cameraProblem, parseScan, scanProblem, typedTarget, type CameraState } from "../scan.ts";
import { CameraScanner } from "../scanner.tsx";
import { GuestCardBody, type CardSeed } from "./card.tsx";
import { BoothLayer } from "./layer.tsx";
import { cameraOn, closedGate } from "./model.ts";

/** How long a just-closed card's pass is ignored by the camera. */
export const CLOSED_PASS_MS = 4000;

/** The typed-id fallback (no camera, plain http, a pass that won't read). */
export function Scanner({ onScan, busy = false }: { onScan: (id: string) => void; busy?: boolean }) {
  const [manual, setManual] = useState("");
  const typed = () => {
    const target = typedTarget(manual);
    if (!target) return;
    onScan(target);
    setManual("");
  };
  return (
    <form
      className="booth-typed"
      onSubmit={(e) => {
        e.preventDefault();
        typed();
      }}
    >
      <label className="booth-typed-label" htmlFor="booth-typed-id">
        Or type the id on their pass
      </label>
      <div className="booth-typed-row">
        <input
          id="booth-typed-id"
          className="w95-inset"
          placeholder="g-1a2b3c"
          value={manual}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => setManual(e.target.value)}
        />
        <button type="submit" className="w95-btn" disabled={busy || manual.trim() === ""}>
          Scan
        </button>
      </div>
    </form>
  );
}

/**
 * The scanner window. `open` cards come from a scan; `onOpenThread` opens a
 * guest's thread (and closes the scanner).
 */
export function ScannerScreen({
  session,
  admin,
  onClose,
  onOpenThread,
}: {
  session: PrimeSession;
  admin: boolean;
  onClose: () => void;
  onOpenThread: (guestId: string) => void;
}) {
  const [cam, setCam] = useState<CameraState>("off");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{ id: string; seed: CardSeed } | null>(null);
  const gate = useMemo(() => closedGate(CLOSED_PASS_MS), []);
  const problem = cameraProblem(cam);
  const live = cameraOn(true, card !== null);

  const doScan = (id: string) => {
    if (!id || busy) return;
    setErr("");
    setNote(`Scanning ${id}…`);
    setBusy(true);
    session.scan(id).then(
      (r) => {
        setBusy(false);
        setNote("");
        setCard({ id: r.guest.id, seed: { card: r.card, replies: r.responses } });
      },
      (e) => {
        setBusy(false);
        setNote("");
        setErr(e instanceof Error ? e.message : String(e));
      },
    );
  };
  const onCode = (raw: string) => {
    const hit = parseScan(raw);
    if (hit.kind !== "guest") {
      setNote(scanProblem(hit) ?? "");
      return;
    }
    if (!gate.allows(hit.id)) return;
    doScan(hit.id);
  };
  const next = () => {
    if (card !== null) gate.closed(card.id);
    setCard(null);
  };

  if (card !== null) {
    const name = card.seed.card?.guest.name ?? session.view?.guests.find((g) => g.id === card.id)?.name ?? card.id;
    return (
      <BoothLayer title={`🪪 ${name}`} label={`${name}'s card`} onClose={onClose}>
        <GuestCardBody
          key={card.id}
          session={session}
          guestId={card.id}
          seed={card.seed}
          admin={admin}
          onOpenThread={() => onOpenThread(card.id)}
          onNext={next}
        />
      </BoothLayer>
    );
  }
  return (
    <BoothLayer title="📷 Scan a pass" label="Scanner" onClose={onClose}>
      <div className="booth-scan">
        <div className={`booth-cam ${cam}`}>
          {live && !problem && <CameraScanner onCode={onCode} onState={setCam} />}
          {problem !== null ? (
            <p className="booth-cam-msg">{problem}</p>
          ) : cam !== "live" ? (
            <p className="booth-cam-msg">Starting the camera…</p>
          ) : null}
        </div>
        <p className="booth-scan-hint" role="status" aria-live="polite">
          {note !== "" ? note : cam === "live" ? "Hold a pass up to the camera. It stays on for the next guest." : " "}
        </p>
        {err && (
          <div className="booth-err" role="alert">
            {err}
          </div>
        )}
        <Scanner onScan={doScan} busy={busy} />
      </div>
    </BoothLayer>
  );
}
