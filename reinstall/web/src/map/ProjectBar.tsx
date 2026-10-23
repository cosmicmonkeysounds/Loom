//! The map page's project bar (SW-MAP-01 / SW-MAP-13; `docs/loom-reinstall.md`
//! §2.1): one toggle button per whole-map variant of the event
//! (`house.json`, `house.shed.json`, … — the active one pressed), **Save to
//! project** and **Download JSON**. Self-contained — it fetches the variant
//! list itself and refetches whenever `version` or `remoteVersion` changes
//! (a switch or a save anywhere, also while the page holds a draft and so
//! keeps its old `version`), so a host only hands it the map it shows:
//!
//!   <ProjectBar
//!     base={baseOf(config)}        // the event's API base
//!     token={config.token}         // the device's moderator token
//!     house={saved}                // the map the page shows (not a draft)
//!     version={loaded.version}     // its version; null = the bundled stand-in
//!     remoteVersion={announced}    // optional: the server's latest version off the stream
//!     players={players.size}       // programs in the simulation (a switch asks first)
//!     dirty={dirty}                // unsaved edits ("Save to project" warns)
//!     onSwitched={(house, version) => …}  // load it as the clean draft
//!     onSaved={(file) => …}        // optional: e.g. reload (the source is now "project")
//!     saveDraft={() => …}          // optional: save a valid draft to the event first
//!     unlock={() => …}             // optional: the passcode re-check before a write (W-15)
//!   />
//!
//! `MapApp` mounts it through `projectBarExtras` (its `toolbarExtras` slot,
//! `main.tsx`): a switch reloads the page onto the server's new map — the
//! switch is already live for every player, so it lands as a clean draft
//! with the server's version, never as an unsaved edit; a save to the
//! project reloads too (the map's source is the project again).
//!
//! The decisions live in `project.ts` (pure, tested) — incl. `sourceLabel`,
//! the page's "where this map comes from" line (`source: "project"` too).

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { HouseMap, MapVariantsResponse } from "@loom/house";
import { fetchHouse, fetchVariants, saveToProject, switchVariant } from "../api.ts";
import {
  lightsProjectPlan,
  switchLightsOffer,
  activeOf,
  canSaveToProject,
  canSwitch,
  downloadOf,
  pressTarget,
  planSwitch,
  saveConfirm,
  saveTarget,
  statusOf,
  variantLabel,
  variantName,
  variantTitle,
  type BarStatus,
} from "./project.ts";
import { saveBaseOf } from "./edit.ts";
import type { LightsBarContext, MapToolbarContext } from "./tools.ts";

export interface ProjectBarProps {
  /** The event's API base (`baseOf(config)`). */
  base: string;
  /** The device's moderator token. */
  token: string;
  /** The map the page shows (the saved one) — what "Download JSON" downloads. */
  house: HouseMap;
  /** Its version; null = the bundled stand-in ("Save to project" is off). */
  version: string | null;
  /** The version the server last announced (the spatial stream): a switch
   *  made elsewhere while this page holds a draft refreshes the list. */
  remoteVersion?: string | null;
  /** Programs in the simulation now — a switch asks first when any are. */
  players?: number;
  /** The page holds unsaved edits ("Save to project" says they are not included). */
  dirty?: boolean;
  /** A switch landed: the event's new map and its version. */
  onSwitched: (house: HouseMap, version: string) => void;
  /** A save to the project landed. */
  onSaved?: (file: string) => void;
  /** Save the page's (valid) unsaved edits to the event first, so "Save to
   *  project" writes what is on screen: resolves to the new version, null
   *  when the save was refused. Left out when the draft can't be saved. */
  saveDraft?: () => Promise<string | null>;
  /** Ask the director (default `window.confirm`). */
  confirm?: (message: string) => boolean;
  /** Before a switch or a save to the project: the moderator passcode again
   *  (`MapUnlock`, once per page load); false = cancelled, nothing is written. */
  unlock?: () => Promise<boolean>;
  /** The house lights (wave 20): Save to project writes `lights.json` too,
   *  and a switch offers to save unsaved light edits first. */
  lights?: LightsBarContext;
}

export function ProjectBar({ base, token, house, version, remoteVersion = null, players = 0, dirty = false, onSwitched, onSaved, saveDraft, confirm = (m) => window.confirm(m), unlock = async () => true, lights }: ProjectBarProps) {
  const [list, setList] = useState<MapVariantsResponse | null>(null);
  const [status, setStatus] = useState<BarStatus>({ kind: "idle" });
  const busy = status.kind === "busy";

  const refresh = useCallback(async (): Promise<MapVariantsResponse | null> => {
    try {
      const next = await fetchVariants(base, token);
      setList(next);
      return next;
    } catch {
      setList(null); // an older server, or away: the bar offers the download only
      return null;
    }
  }, [base, token]);
  useEffect(() => {
    void refresh();
  }, [refresh, version, remoteVersion]);

  const toVariant = async (file: string) => {
    // A press on the "live" one refetches first: the list may be stale.
    const press = await pressTarget(file, list, busy, refresh);
    if (press === null) return;
    const { v, list: current } = press;
    if (press.live) {
      setStatus({ kind: "ok", text: `${variantName(v, current?.variants ?? [])} is already live.` });
      return;
    }
    if (!canSwitch(v, busy)) return;
    if (!(await unlock())) return;
    const all = current?.variants ?? [];
    // Unsaved light edits: saved first when the director says so.
    const lightsAsk = switchLightsOffer(lights);
    if (lightsAsk !== null && lights !== undefined && confirm(lightsAsk) && (await lights.save()) === null) {
      setStatus({ kind: "error", text: "The light edits didn't save (see the 💡 Lights tab) — nothing was switched." });
      return;
    }
    // A director's save on the event is offered to the project first; the
    // switch then posts from the version that save left (the reload the
    // switch does covers the save's `onSaved`, unless it stops there).
    let saved: string | null = null;
    const save = async (f: string, at: string | null) => {
      const next = await saveToProjectNow(f, at, false);
      if (next !== null) saved = f;
      return next;
    };
    const plan = await planSwitch(v, current, { players, dirty, version }, { confirm, save });
    if (plan === null) {
      if (saved !== null) onSaved?.(saved);
      void refresh();
      return;
    }
    setStatus({ kind: "busy", what: `Switching to ${variantName(v, all)}…` });
    try {
      const r = await switchVariant(base, token, file, plan.base);
      if (r.ok) {
        const loaded = await fetchHouse(base, token);
        if (loaded.source === "bundled") setStatus({ kind: "error", text: `Playing ${file}, but the map did not load here — reload the page.` });
        else {
          onSwitched(loaded.house, loaded.version);
          setStatus(statusOf(r, "switch", variantLabel(v, all)));
        }
      } else setStatus(statusOf(r, "switch"));
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
    void refresh();
  };

  /** Write the event's map into the project as `file` from `at`: the
   *  version it leaves, null when it failed (the status line says why). */
  const saveToProjectNow = async (file: string, at: string | null, notify = true): Promise<string | null> => {
    setStatus({ kind: "busy", what: `Saving ${file} to the project…` });
    try {
      const r = await saveToProject(base, token, file, at);
      setStatus(statusOf(r, "save"));
      if (!r.ok) return null;
      if (notify) onSaved?.(r.result.file);
      return r.result.version;
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
      return null;
    }
  };

  const toProject = async () => {
    if (!(await unlock())) return;
    const file = saveTarget(list);
    const withDraft = dirty && saveDraft !== undefined;
    const ask = saveConfirm(file, dirty, withDraft);
    if (ask !== null && !confirm(ask)) return;
    let at = version;
    if (withDraft) {
      setStatus({ kind: "busy", what: "Saving your edits…" });
      try {
        at = await saveDraft();
      } catch {
        at = null;
      }
      if (at === null) {
        setStatus({ kind: "error", text: "Your edits didn't save (see the problem list) — nothing was written to the project." });
        return;
      }
    }
    const mapAt = await saveToProjectNow(file, at);
    void refresh();
    if (mapAt === null) return;
    // The lights follow the map into the project (a light edit saved to the event first).
    const plan = lightsProjectPlan(lights);
    if (lights === undefined || plan.step === "none") {
      if (plan.skipped !== null) setStatus({ kind: "ok", text: `Saved ${file} to the project — ${plan.skipped}.` });
      return;
    }
    setStatus({ kind: "busy", what: "Saving lights.json to the project…" });
    if (plan.step === "save" && (await lights.save()) === null) {
      setStatus({ kind: "error", text: `Saved ${file} to the project, but the light edits didn't save (see the 💡 Lights tab).` });
      return;
    }
    const ok = await lights.toProject();
    setStatus(ok ? { kind: "ok", text: `Saved ${file} and lights.json to the project${plan.skipped !== null ? ` — ${plan.skipped}` : ""}` } : { kind: "error", text: `Saved ${file} to the project, but not lights.json (see the 💡 Lights tab).` });
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
  const all = list?.variants ?? [];
  return (
    <div className="map-project" role="group" aria-label="The house map's project">
      {list !== null && list.variants.length > 1 && (
        <div className="w98-tabs" role="radiogroup" aria-label="Map variant">
          <span className="map-status" title="The whole-map variants this event can play — the pressed one is live for every player">
            Map:
          </span>
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
              {variantLabel(v, all)}
              {v.active && <span className="live-tag"> ● live</span>}
            </button>
          ))}
        </div>
      )}
      {list !== null && list.variants.length === 1 && active !== null && (
        <span className="map-status" title={variantTitle(active)}>
          {active.file}
        </span>
      )}
      {list?.project === true && (
        <button className="w98-button small" disabled={!canSaveToProject(list, version, busy)} onClick={() => void toProject()} title={`Write the map into the project as ${saveTarget(list)}${dirty && saveDraft !== undefined ? " (your edits are saved first)" : ""}${lightsProjectPlan(lights).step !== "none" ? ", and the lights as lights.json" : ""} — the next launch and every co-writer see it`}>
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

/**
 * The project bar in `MapApp`'s toolbar slot (`main.tsx`): fed from the
 * editor's state. A switch reloads onto the server's map (clean, its
 * version); a save to the project reloads; a valid unsaved draft is saved
 * to the event on the way to the project.
 */
export function projectBarExtras(ctx: MapToolbarContext): ReactNode {
  if (ctx.loaded.source === "bundled") return null; // offline: nothing to switch or save
  const saveDraft = ctx.dirty && ctx.valid ? ctx.save : undefined;
  return (
    <ProjectBar
      base={ctx.base}
      token={ctx.config.token}
      house={ctx.saved ?? ctx.house}
      version={saveBaseOf(ctx.loaded)}
      remoteVersion={ctx.remoteVersion}
      players={ctx.players}
      dirty={ctx.dirty}
      onSwitched={() => void ctx.reload()}
      onSaved={() => void ctx.reload()}
      unlock={ctx.unlock}
      {...(saveDraft !== undefined ? { saveDraft } : {})}
      {...(ctx.lights !== undefined ? { lights: ctx.lights } : {})}
    />
  );
}
