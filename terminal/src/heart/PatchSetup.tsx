//! ⚙'s patch bay section (wave 22), under the door sensor's: whether this
//! terminal bridges the bay (`bay`), the live readings per input (raw counts,
//! volts, the source it decodes to) and, per source, its learnt level with a
//! **Learn** button (`pb learn V<k>`: exactly one cable in, from that source
//! into any input), plus **Save** (`pb save`) and **Reset** (`pb reset`).
//! Crew-only, behind ⚙'s 2 s hold. The crew check: patch V1 into D1 … D7 in
//! turn and see every row read V1; then V2 … V8 into one input. Nothing here
//! knows which combinations matter (the story does).

import { useEffect, useState } from "react";
import type { BayCommand, PbcalLine } from "../serial/door-protocol.ts";
import { doorActions, patchStatusText, useDoorStatus } from "../serial/door-status.ts";

/** Volts off a 12-bit reading on the M4's 3.3 V rail. */
export function volts(raw: number): string {
  return ((raw * 3.3) / 4095).toFixed(2);
}

/** How a decode reads in the table: `V3`, `—` empty, `?` between levels. */
export function sourceLabel(src: number): string {
  return src > 0 ? `V${src}` : src === 0 ? "—" : "?";
}

export function PatchSetup({ bay, onBay, running }: { bay: boolean; onBay: (b: boolean) => void; running: boolean }) {
  const status = useDoorStatus();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const levels: PbcalLine | null = status.pbcal !== null && status.pbcal.t === "pbcal" ? status.pbcal : null;

  const send = (cmd: BayCommand, doing: string) => {
    const a = doorActions();
    if (a === null) {
      setNote("save first: the board connects once this terminal is set up with it");
      return;
    }
    setBusy(true);
    setNote(doing);
    void a.bay(cmd).then((l) => {
      setBusy(false);
      if (l.t === "err") setNote(`the board said: ${l.error}`);
      else if (cmd.op === "learn") setNote(`V${l.src} read ${l.raw} (${volts(l.raw)} V) — Save to keep it`);
      else if (cmd.op === "save") setNote(l.saved ? "saved on the board" : "not saved");
      else if (cmd.op === "reset") setNote("back to the nominal levels — Save to keep them");
      else setNote(null);
    });
  };

  // Ask the board for its levels once the bay shows.
  useEffect(() => {
    if (running && status.bay && status.connected && levels === null) {
      const a = doorActions();
      if (a !== null) void a.bay({ c: "pb", op: "get" });
    }
  }, [running, status.bay, status.connected, levels]);

  const text = patchStatusText(status);
  const p = status.patch;
  return (
    <fieldset className="door-setup patch-setup">
      <legend>patch bay</legend>
      <label className="check">
        <input type="checkbox" checked={bay} onChange={(e) => onBay(e.target.checked)} />
        read the patch bay on this board <span className="muted">(the story judges the cables; untick to leave it to the 🔌 buttons)</span>
      </label>
      {running && bay && !status.bay && status.board !== null && <div className="small warn">this board reads no patch bay (firmware before 1.2.0, or built without one)</div>}
      {running && text !== null && <div className={`small ${status.connected ? "muted" : "warn"}`}>{text}</div>}
      {running && status.bay && p !== null && (
        <table className="patch-table small">
          <thead>
            <tr>
              <th>input</th>
              <th>raw</th>
              <th>volts</th>
              <th>reads</th>
            </tr>
          </thead>
          <tbody>
            {p.src.map((k, i) => (
              <tr key={i} className={k === -1 ? "warn" : k === 0 ? "muted" : ""}>
                <td>D{i + 1}</td>
                <td>{p.raw[i]}</td>
                <td>{volts(p.raw[i] ?? 0)}</td>
                <td>{sourceLabel(k)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {running && status.bay && levels !== null && (
        <table className="patch-table small">
          <thead>
            <tr>
              <th>source</th>
              <th>level</th>
              <th>band</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {levels.levels.map((lv, k) => (
              <tr key={k}>
                <td>V{k + 1}</td>
                <td>
                  {lv} <span className="muted">({volts(lv)} V)</span>
                </td>
                <td className="muted">
                  {Math.max(0, lv - levels.tol)}–{Math.min(4095, lv + levels.tol)}
                </td>
                <td>
                  <button type="button" disabled={busy} onClick={() => send({ c: "pb", op: "learn", source: k + 1 }, `learning V${k + 1}: one cable, from V${k + 1} into any input… (1 s)`)}>
                    Learn
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {running && status.bay && (
        <div className="door-setup-row">
          <button type="button" disabled={busy} onClick={() => send({ c: "pb", op: "save" }, "saving…")}>
            Save
          </button>
          <button type="button" disabled={busy} onClick={() => send({ c: "pb", op: "reset" }, "resetting…")}>
            Reset
          </button>
          {levels !== null && <span className="small muted">empty under {levels.floor} · a source within ±{levels.tol}{levels.saved ? " · saved" : " · not saved"}</span>}
        </div>
      )}
      {note !== null && <div className="small muted">{note}</div>}
    </fieldset>
  );
}
