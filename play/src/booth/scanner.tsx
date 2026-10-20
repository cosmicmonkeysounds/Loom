//! The booth's scanner: camera / typed id, and the pinned Scanner room with
//! its readouts (moved out of `performer.tsx` in wave 13).

import { useState } from "react";
import type { PrimeSession } from "../session/prime.ts";
import { cameraProblem, parseScan, scanProblem, typedTarget, type CameraState } from "../scan.ts";
import { CameraScanner } from "../scanner.tsx";

export function Scanner({ onScan }: { onScan: (id: string) => void }) {
  const [manual, setManual] = useState("");
  const [camOn, setCamOn] = useState(false);
  const [cam, setCam] = useState<CameraState>("off");
  const [note, setNote] = useState("");
  const problem = cameraProblem(cam);
  // The camera stays on between passes — a door queue scans one after
  // another; a wall QR or a stray code just says so.
  const onCode = (raw: string) => {
    const hit = parseScan(raw);
    if (hit.kind === "guest") {
      setNote(`✓ ${hit.id}`);
      onScan(hit.id);
    } else setNote(scanProblem(hit) ?? "");
  };
  const typed = () => {
    const target = typedTarget(manual);
    if (!target) return;
    onScan(target);
    setManual("");
  };
  return (
    <div className="card">
      <input
        placeholder="Guest id (e.g. g-1a2b3c)"
        value={manual}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setManual(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && typed()}
      />
      <button className="choice primary" onClick={typed}>
        Scan
      </button>
      <button
        className="choice ghost"
        onClick={() => {
          setNote("");
          setCam("off");
          setCamOn((v) => !v);
        }}
      >
        {camOn ? "Stop camera" : "📷 Use camera"}
      </button>
      {camOn && !problem && <CameraScanner onCode={onCode} onState={setCam} />}
      {camOn && cam === "live" && <div className="muted pad">Hold a pass up to the camera — it stays on for the next guest.</div>}
      {note && <div className="muted pad">{note}</div>}
      {problem && <div className="err">{problem}</div>}
    </div>
  );
}

/** The pinned Scanner thread: camera/manual entry + the live scan readouts. */
export function ScannerScreen({ session, onBack, wide }: { session: PrimeSession; onBack: () => void; wide: boolean }) {
  const [err, setErr] = useState("");
  const doScan = (id: string) => {
    if (!id) return;
    setErr("");
    void session.scan(id).catch((e) => setErr((e as Error).message));
  };
  return (
    <div className="screen stage">
      <header className="thread-head">
        {!wide && (
          <button className="back" onClick={onBack} aria-label="Back">
            ‹
          </button>
        )}
        <div className="avatar scanner">📷</div>
        <div className="thread-id">
          <strong>Scanner</strong>
          <span className="muted">scan a guest's pass</span>
        </div>
      </header>
      <div className="station">
        <Scanner onScan={doScan} />
        {err && <div className="err">{err}</div>}
        <div className="card">
          <h2>Readouts</h2>
          {session.responses.length === 0 ? (
            <div className="muted pad">Scan a guest to deliver their beat.</div>
          ) : (
            session.responses.map((r) => (
              <div key={r.id} className="readout">
                🖥️ {r.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
