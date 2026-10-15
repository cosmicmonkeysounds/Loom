//! The map page's toolbar: the floors (a tab each, `+ Floor`), the Edit
//! switch, the drawing tools with a typed "W × D" entry, the snap step,
//! undo / redo, revert, a blank house, save — and the slot for extras
//! (the project bar: variants, Save to project, Download JSON).

import { useState } from "react";
import type { ReactNode } from "react";
import type { HouseMap, PlayerState } from "@loom/house";
import type { LoadedHouse } from "../api.ts";
import { SNAP_STEPS } from "./plan.ts";
import { sourceLabel } from "./project.ts";
import { TOOLS, type Tool } from "./tools.ts";

export interface ToolbarProps {
  house: HouseMap;
  floor: string;
  players: ReadonlyMap<string, PlayerState>;
  loaded: LoadedHouse;
  live: boolean;
  edit: boolean;
  editable: boolean;
  tool: Tool;
  snapStep: number;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The 3D preview is showing instead of the plan. */
  view3d: boolean;
  /** Extras for the toolbar (the project bar) — rendered before the status. */
  extras?: ReactNode;
  onFloor: (id: string) => void;
  onFloorInspect: (id: string) => void;
  onAddFloor: () => void;
  onEdit: (on: boolean) => void;
  onView3d: (on: boolean) => void;
  onTool: (t: Tool) => void;
  onSnap: (step: number) => void;
  onAddSized: (w: number, d: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRevert: () => void;
  onBlank: () => void;
  onSave: () => void;
}

export function Toolbar(p: ToolbarProps) {
  const [w, setW] = useState("4");
  const [d, setD] = useState("3");
  const sized = Number(w) > 0 && Number(d) > 0;
  return (
    <header className="map-toolbar w98-raised">
      <div className="map-toolbar-row">
        <span className="map-title">🗺 {p.house.name}</span>
        <div className="w98-tabs floor-tabs" role="tablist" aria-label="Floors">
          {p.house.floors.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={f.id === p.floor}
              className={`w98-tab${f.id === p.floor ? " on" : ""}`}
              onClick={() => (f.id === p.floor ? p.onFloorInspect(f.id) : p.onFloor(f.id))}
              title={f.id === p.floor ? "Click again to edit this floor" : `${f.label} · ${f.elevation} m`}
            >
              {f.label}
              {[...p.players.values()].some((x) => x.floor === f.id) && <span className="tab-dot" />}
            </button>
          ))}
          {p.edit && (
            <button className="w98-tab add" onClick={p.onAddFloor} title="Add a floor above the top one">
              + Floor
            </button>
          )}
        </div>
        <span className="spacer" />
        <button className={`w98-button${p.view3d ? " pressed" : ""}`} aria-pressed={p.view3d} onClick={() => p.onView3d(!p.view3d)} title="Look at the draft in 3D, as the games build it">
          {p.view3d ? "▦ Plan" : "🧊 3D"}
        </button>
        <label className="radio checkbox">
          <input type="checkbox" checked={p.edit} disabled={!p.editable} onChange={(e) => p.onEdit(e.target.checked)} /> Edit
        </label>
        {p.edit && (
          <>
            <button className="w98-button" disabled={!p.canUndo} onClick={p.onUndo} title="Undo (⌘Z)">
              ↶ Undo
            </button>
            <button className="w98-button" disabled={!p.canRedo} onClick={p.onRedo} title="Redo (⇧⌘Z)">
              ↷ Redo
            </button>
            <button className="w98-button" disabled={!p.dirty} onClick={p.onRevert} title="Back to the map as loaded">
              Revert
            </button>
            <button className="w98-button default" disabled={!p.canSave} onClick={p.onSave}>
              {p.saving ? "Saving…" : "💾 Save"}
            </button>
          </>
        )}
        {/* Toolbar extras — the project bar (`ProjectBar.tsx`: variant switch, Save to project, Download JSON) plugs in here via `MapApp`'s `toolbarExtras`. */}
        {p.extras}
        <span className="map-status">
          <span className={`led${p.live ? " on" : ""}`} />
          {p.loaded.source === "bundled" ? sourceLabel("bundled") : `${sourceLabel(p.loaded.source)} · v${p.loaded.version}`}
          {p.dirty && <b> · unsaved</b>}
        </span>
        <a className="w98-button" href="./" title="Back to the game">
          ✕
        </a>
      </div>
      {p.edit && (
        <div className="map-toolbar-row tools" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={`w98-button tool${p.tool === t.id ? " pressed" : ""}`} aria-pressed={p.tool === t.id} onClick={() => p.onTool(t.id)} title={t.hint}>
              {t.label}
            </button>
          ))}
          {(p.tool === "room" || p.tool === "yard") && (
            <span className="sized">
              <input className="w98-input" type="number" min="0.3" step="0.05" value={w} onChange={(e) => setW(e.target.value)} aria-label="width (x), metres" />
              ×
              <input className="w98-input" type="number" min="0.3" step="0.05" value={d} onChange={(e) => setD(e.target.value)} aria-label="depth (z), metres" />
              m
              <button className="w98-button" disabled={!sized} onClick={() => p.onAddSized(Number(w), Number(d))} title="Add a room this size east of the selected room (else east of everything on this floor)">
                Add
              </button>
            </span>
          )}
          <span className="spacer" />
          <label className="snap">
            snap
            <select className="w98-input" value={p.snapStep} onChange={(e) => p.onSnap(Number(e.target.value))}>
              {SNAP_STEPS.map((s) => (
                <option key={s} value={s}>
                  {Math.round(s * 100)} cm
                </option>
              ))}
            </select>
          </label>
          <button className="w98-button" onClick={p.onBlank} title="Start over from one floor and a yard">
            New blank house…
          </button>
        </div>
      )}
    </header>
  );
}
