//! The map page's project bar (SW-MAP-01 / SW-MAP-13; `docs/loom-reinstall.md`
//! §2.1): one toggle button per whole-map variant of the event
//! (`house.json`, `house.shed.json`, … — the active one pressed), **Save to
//! project** and **Download JSON**. Self-contained — it fetches the variant
//! list itself and refetches whenever `version` changes (a switch or a save
//! anywhere), so a host only hands it the map it shows:
//!
//!   <ProjectBar
//!     base={baseOf(config)}        // the event's API base
//!     token={config.token}         // the device's moderator token
//!     house={saved}                // the map the page shows (not a draft)
//!     version={loaded.version}     // its version; null = the bundled stand-in
//!     players={players.size}       // programs in the simulation (a switch asks first)
//!     dirty={dirty}                // unsaved edits ("Save to project" warns)
//!     onSwitched={(house, version) => …}  // load it as the clean draft
//!     onSaved={(file) => …}        // optional: e.g. reload (the source is now "project")
//!   />
//!
//! The decisions live in `project.ts` (pure, tested).

import { useCallback, useEffect, useState } from "react";
import type { HouseMap, MapVariantsResponse } from "@loom/house";
import { fetchHouse, fetchVariants, saveToProject, switchVariant } from "../api.ts";
import {
  activeOf,
  canSaveToProject,
  canSwitch,
  downloadOf,
  saveConfirm,
  saveTarget,
  statusOf,
  switchConfirm,
  variantLabel,
  variantTitle,
  type BarStatus,
} from "./project.ts";

export interface ProjectBarProps {
  /** The event's API base (`baseOf(config)`). */
  base: string;
  /** The device's moderator token. */
  token: string;
  /** The map the page shows (the saved one) — what "Download JSON" downloads. */
  house: HouseMap;
  /** Its version; null = the bundled stand-in ("Save to project" is off). */
  version: string | null;
  /** Programs in the simulation now — a switch asks first when any are. */
  players?: number;
  /** The page holds unsaved edits ("Save to project" says they are not included). */
  dirty?: boolean;
  /** A switch landed: the event's new map and its version. */
  onSwitched: (house: HouseMap, version: string) => void;
  /** A save to the project landed. */
  onSaved?: (file: string) => void;
  /** Ask the director (default `window.confirm`). */
  confirm?: (message: string) => boolean;
}

export function ProjectBar({ base, token, house, version, players = 0, dirty = false, onSwitched, onSaved, confirm = (m) => window.confirm(m) }: ProjectBarProps) {
  const [list, setList] = useState<MapVariantsResponse | null>(null);
  const [status, setStatus] = useState<BarStatus>({ kind: "idle" });
  const busy = status.kind === "busy";

  const refresh = useCallback(async () => {
    try {
      setList(await fetchVariants(base, token));
    } catch {
      setList(null); // an older server, or away: the bar offers the download only
    }
  }, [base, token]);
  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  const toVariant = async (file: string) => {
    const v = list?.variants.find((x) => x.file === file);
    if (v === undefined || !canSwitch(v, busy)) return;
    const ask = switchConfirm(v, { players, edited: list?.edited ?? false });
    if (ask !== null && !confirm(ask)) return;
    setStatus({ kind: "busy", what: `Switching to ${file}…` });
    try {
      const r = await switchVariant(base, token, file, version);
      if (r.ok) {
        const loaded = await fetchHouse(base, token);
        if (loaded.source === "bundled") setStatus({ kind: "error", text: `Playing ${file}, but the map did not load here — reload the page.` });
        else {
          onSwitched(loaded.house, loaded.version);
          setStatus(statusOf(r, "switch"));
        }
      } else setStatus(statusOf(r, "switch"));
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
    void refresh();
  };

  const toProject = async () => {
    const file = saveTarget(list);
    const ask = saveConfirm(file, dirty);
    if (ask !== null && !confirm(ask)) return;
    setStatus({ kind: "busy", what: `Saving ${file} to the project…` });
    try {
      const r = await saveToProject(base, token, null, version);
      setStatus(statusOf(r, "save"));
      if (r.ok) onSaved?.(r.result.file);
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
    void refresh();
  };

  const download = () => {
    const { name, text } = downloadOf(house, list);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const active = activeOf(list);
  return (
    <div className="map-project" role="group" aria-label="The house map's project">
      {list !== null && list.variants.length > 1 && (
        <div className="w98-tabs" role="radiogroup" aria-label="Map variant">
          {list.variants.map((v) => (
            <button
              key={v.file}
              className={`w98-button small${v.active ? " default" : ""}`}
              role="radio"
              aria-checked={v.active}
              aria-pressed={v.active}
              disabled={!v.active && !canSwitch(v, busy)}
              title={variantTitle(v)}
              onClick={() => void toVariant(v.file)}
            >
              {v.ok ? "" : "⚠ "}
              {variantLabel(v)}
            </button>
          ))}
        </div>
      )}
      {list !== null && list.variants.length === 1 && active !== null && <span className="map-status">{active.file}</span>}
      {list?.project === true && (
        <button className="w98-button small" disabled={!canSaveToProject(list, version, busy)} onClick={() => void toProject()} title={`Write the event's map into the project as ${saveTarget(list)} — the next launch and every co-writer see it`}>
          Save to project
        </button>
      )}
      <button className="w98-button small" onClick={download} title="Download the map as JSON (to commit as the show's file)">
        Download JSON
      </button>
      {status.kind !== "idle" && (
        <span className={`map-status${status.kind === "error" ? " error" : ""}`} role="status">
          {status.kind === "busy" ? status.what : status.text}
        </span>
      )}
    </div>
  );
}
