//! ⚙'s door sensor section (wave 20): the sensor (none / Web Serial / the
//! dev keys), a keyboard or not, *Connect door sensor* (grants the port once
//! per browser profile — a click, so Chrome may ask), the live reading and
//! the two calibration buttons. The bridge itself runs in the app
//! (`serial/use-door.ts`) for the saved config; this only talks to it.

import { useEffect, useState } from "react";
import type { DoorConfig } from "../config.ts";
import { doorActions, doorRescan, doorStatusText, useDoorStatus } from "../serial/door-status.ts";
import { loadDoorSerial } from "../serial/use-door.ts";

export function DoorSetup({ door, onDoor, keys, onKeys, saved }: { door: DoorConfig; onDoor: (d: DoorConfig) => void; keys: boolean; onKeys: (k: boolean) => void; saved: DoorConfig | null }) {
  const status = useDoorStatus();
  const [note, setNote] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState<"closed" | "open" | null>(null);
  const hasSerial = typeof navigator !== "undefined" && "serial" in navigator;
  const running = saved !== null && saved !== "off" && saved === door;

  const connect = () => {
    setNote(null);
    // The module is fetched the moment this section shows (below), so the
    // port request runs inside the click's user activation.
    void loadDoorSerial()
      .then((m) => m.requestDoorPort())
      .then((problem) => {
        setNote(problem ?? (running ? "port granted — connecting…" : "port granted — Save, and this terminal connects to it on every boot"));
        if (problem === null) doorRescan();
      })
      .catch((e: Error) => setNote(e.message));
  };

  const calibrate = (which: "closed" | "open") => {
    const a = doorActions();
    if (a === null) {
      setNote("save first: the sensor connects once this terminal is set up with it");
      return;
    }
    setCalibrating(which);
    setNote(which === "closed" ? "hold the door shut… (2 s)" : "hold the door wide open… (2 s)");
    void a.calibrate(which).then((l) => {
      setCalibrating(null);
      setNote(l.t === "cal" ? `${l.which === "closed" ? "shut" : "open"} read ${l.ref} · shut above ${l.close}, open below ${l.open}${l.which === "open" ? " — saved" : " — now open the door and press Calibrate: door open"}` : `the sensor said: ${l.error}`);
    });
  };

  useEffect(() => {
    if (door === "serial" && hasSerial) void loadDoorSerial().catch(() => {});
  }, [door, hasSerial]);

  return (
    <fieldset className="door-setup">
      <legend>door sensor</legend>
      <label>
        sensor{" "}
        <select value={door} onChange={(e) => onDoor(e.target.value as DoorConfig)}>
          <option value="off">none</option>
          <option value="serial">the door sensor (USB, Web Serial)</option>
          <option value="sim">simulated — keys O open, C shut, F fault (testing only)</option>
        </select>
      </label>
      {door === "serial" && !hasSerial && <div className="small warn">this browser can't reach a USB sensor: use desktop Chrome on https (or localhost)</div>}
      {door === "serial" && hasSerial && (
        <div className="door-setup-row">
          <button type="button" onClick={connect}>
            Connect door sensor
          </button>
          <button type="button" onClick={() => calibrate("closed")} disabled={calibrating !== null || !running}>
            Calibrate: door shut
          </button>
          <button type="button" onClick={() => calibrate("open")} disabled={calibrating !== null || !running}>
            Calibrate: door open
          </button>
        </div>
      )}
      {running && <div className={`small ${status.connected ? "muted" : "warn"}`}>{doorStatusText(status)}</div>}
      {note !== null && <div className="small muted">{note}</div>}
      <label className="check">
        <input type="checkbox" checked={keys} onChange={(e) => onKeys(e.target.checked)} />
        a keyboard is here <span className="muted">(untick for a mouse-only screen: no typing, only the choices)</span>
      </label>
    </fieldset>
  );
}
