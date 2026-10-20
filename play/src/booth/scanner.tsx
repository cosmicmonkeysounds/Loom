//! The booth's scanner (wave 13): the taskbar's 📷 Scan opens it with the
//! camera already on and a typed-id box under it. A pass the camera reads
//! (or an id typed) is scanned at once and that guest's card opens in its
//! place — the story's reply on it, the buttons that matter now on its
//! face. "📷 Next guest", the window's × or Escape on a card bring the live
//! camera back, so a door queue goes pass after pass; × on the camera leaves.
//! The camera stays mounted (and running) under the card, so the next guest
//! never waits for it to restart; passes it reads while a card is up are
//! dropped, and the pass that was just closed is ignored for a moment
//! (`closedGate`, kept by the booth across scanner openings), so closing a
//! card never re-opens it.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PrimeSession } from "../session/prime.ts";
import { cameraProblem, parseScan, scanProblem, typedTarget, type CameraState } from "../scan.ts";
import { CameraScanner } from "../scanner.tsx";
import { GuestCardBody, type CardSeed } from "./card.tsx";
import { BoothLayer } from "./layer.tsx";
import { cameraOn, closedGate, passAccepted, scannerClose } from "./model.ts";

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

/** The booth's just-closed-pass gate (`closedGate`); `PerformerApp` keeps
 *  one for the whole sign-in, so leaving and reopening the scanner with the
 *  same pass still held up never re-fires its scan. */
export type PassGate = ReturnType<typeof closedGate>;

/**
 * The scanner window. `open` cards come from a scan; `onOpenThread` opens a
 * guest's thread (and closes the scanner).
 */
export function ScannerScreen({
  session,
  admin,
  onClose,
  onOpenThread,
  gate: sharedGate,
  onCardGuest,
}: {
  session: PrimeSession;
  admin: boolean;
  onClose: () => void;
  onOpenThread: (guestId: string) => void;
  gate?: PassGate;
  /** The guest a scan is for (its target at once, the card's guest on the reply): the moments layer drops readouts about them while the card shows them. */
  onCardGuest?: (guestId: string) => void;
}) {
  const [cam, setCam] = useState<CameraState>("off");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{ id: string; seed: CardSeed } | null>(null);
  const ownGate = useMemo(() => closedGate(CLOSED_PASS_MS), []);
  const gate = sharedGate ?? ownGate;
  const problem = cameraProblem(cam);
  const live = cameraOn(true, card !== null);
  const scanBox = useRef<HTMLDivElement>(null);
  // While a card is up the camera section is inert (no Tab stop, no tap).
  useEffect(() => {
    const el = scanBox.current;
    if (el === null) return;
    if (card !== null) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [card]);

  const doScan = (id: string) => {
    if (!id || busy) return;
    setErr("");
    setNote(`Scanning ${id}…`);
    setBusy(true);
    onCardGuest?.(id);
    session.scan(id).then(
      (r) => {
        setBusy(false);
        setNote("");
        onCardGuest?.(r.guest.id);
        setCard({ id: r.guest.id, seed: { card: r.card, replies: r.responses, ...(r.said !== undefined ? { said: r.said } : {}), ...(r.staff !== undefined ? { staff: r.staff } : {}), ...(r.refused !== undefined ? { refused: r.refused } : {}) } });
      },
      (e) => {
        setBusy(false);
        setNote("");
        setErr(e instanceof Error ? e.message : String(e));
      },
    );
  };
  const onCode = (raw: string) => {
    if (card !== null) return; // the camera runs on under the card; its reads wait
    const hit = parseScan(raw);
    if (hit.kind !== "guest") {
      setNote(scanProblem(hit) ?? "");
      return;
    }
    if (!passAccepted(card !== null, busy, gate.allows(hit.id))) return;
    doScan(hit.id);
  };
  const next = () => {
    if (card !== null) gate.closed(card.id);
    setCard(null);
    // A browser may have paused the hidden preview; wake it for the next pass.
    void scanBox.current?.querySelector("video")?.play()?.catch(() => {});
  };
  const close = () => (scannerClose(card !== null) === "camera" ? next() : onClose());

  const name = card === null ? "" : (card.seed.card?.guest.name ?? session.view?.guests.find((g) => g.id === card.id)?.name ?? card.id);
  return (
    <BoothLayer title={card !== null ? `🪪 ${name}` : "📷 Scan a pass"} label={card !== null ? `${name}'s card` : "Scanner"} onClose={close}>
      <div className={`booth-scan ${card !== null ? "behind" : ""}`} ref={scanBox} aria-hidden={card !== null || undefined}>
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
      {card !== null && (
        <GuestCardBody
          key={card.id}
          session={session}
          guestId={card.id}
          seed={card.seed}
          admin={admin}
          onOpenThread={() => {
            gate.closed(card.id);
            onOpenThread(card.id);
          }}
          onNext={next}
        />
      )}
    </BoothLayer>
  );
}
