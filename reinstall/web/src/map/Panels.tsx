//! The map page's side tabs besides the inspector — the terminals'
//! provisioning links, the live players, the raw JSON — and the problem
//! panel under them: `validateHouse`'s problems (each a click away from
//! the thing it names), the walkability and LOCATION warnings, and how
//! the last save went (incl. the 409 copy / reload offer).

import { roomById } from "@loom/house";
import type { HouseMap, PlayerState } from "@loom/house";
import type { Problem } from "./check.ts";
import { provisionLink, type SaveState, type Selection } from "./edit.ts";
import { floorOfRoom, playerColor } from "./plan.ts";

export function TerminalsTab({ house, origin, sel, copy, copied, onPick }: { house: HouseMap; origin: string; sel: Selection | null; copy: (key: string, value: string) => void; copied: string | null; onPick: (sel: Selection, floor: string) => void }) {
  return (
    <div className="term-list">
      <p className="muted small">
        Open a terminal's link on its tablet <b>after adding</b> <code>&amp;code=&lt;mod passcode&gt;</code> — links here never carry the passcode.
      </p>
      {house.terminals.length === 0 && <p className="muted">No terminals yet — select a room and press “+ Terminal here”.</p>}
      {house.terminals.map((t) => {
        const link = provisionLink(origin, t);
        return (
          <div key={t.id} className={`term-row${sel?.kind === "terminal" && sel.id === t.id ? " on" : ""}`}>
            <button className="term-name" onClick={() => onPick({ kind: "terminal", id: t.id }, floorOfRoom(house, t.room))}>
              <b>{t.name}</b> <span className="muted">· {roomById(house, t.room)?.label ?? t.room}</span>
            </button>
            <div className="link-row">
              <input className="w98-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button className="w98-button" onClick={() => copy(t.id, link)}>
                {copied === t.id ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PlayersTab({ house, players, onFloor }: { house: HouseMap; players: ReadonlyMap<string, PlayerState>; onFloor: (floor: string) => void }) {
  return (
    <ul className="player-list">
      {players.size === 0 && <li className="muted">Nobody is in the simulation.</li>}
      {[...players.values()].map((p) => (
        <li key={p.session}>
          <span className="swatch" style={{ background: playerColor(p.guest) }} />
          <b>{p.name}</b> <span className={`badge ${p.world}`}>{p.world.toUpperCase()}</span>
          <div className="muted small">
            {roomById(house, p.room ?? "")?.label ?? "between rooms"} · hunting the duck in {roomById(house, p.duck.room)?.label ?? p.duck.room}
            {p.found ? " · FOUND IT" : ""} · on {p.device}
          </div>
          <button className="w98-button small" onClick={() => onFloor(p.floor)}>
            Show
          </button>
        </li>
      ))}
    </ul>
  );
}

export function JsonTab({ text, edit, onText }: { text: string; edit: boolean; onText: (text: string) => void }) {
  return <textarea className="json w98-input" value={text} readOnly={!edit} spellCheck={false} onChange={(e) => onText(e.target.value)} />;
}

export function ProblemsPanel({
  errors,
  warnings,
  checking,
  saveState,
  copied,
  onPick,
  onCopyDraft,
  onReload,
}: {
  errors: Problem[];
  warnings: Problem[];
  /** The walkability check waits for a valid map. */
  checking: boolean;
  saveState: SaveState;
  copied: string | null;
  onPick: (sel: Selection) => void;
  onCopyDraft: () => void;
  onReload: () => void;
}) {
  const item = (p: Problem, i: number) => (
    <li key={i} className={p.sel !== null ? "pick" : undefined} onClick={p.sel !== null ? () => onPick(p.sel!) : undefined} title={p.sel !== null ? "Select it" : undefined}>
      {p.text}
    </li>
  );
  return (
    <div className={`problems w98-raised${errors.length > 0 ? " bad" : ""}`}>
      {errors.length === 0 ? (
        <div className="ok">✔ The map is valid.</div>
      ) : (
        <>
          <div className="bad-head">
            ⚠ {errors.length} problem{errors.length === 1 ? "" : "s"} — fix before saving
          </div>
          <ul>{errors.slice(0, 40).map(item)}</ul>
        </>
      )}
      {warnings.length > 0 && (
        <>
          <div className="warn-head">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"} (saving is fine)
          </div>
          <ul className="warnings">{warnings.slice(0, 40).map(item)}</ul>
        </>
      )}
      {checking && errors.length > 0 && <div className="muted small">The walk check (spawn → every duck spot) runs once the map is valid.</div>}
      {saveState.kind === "ok" && (
        <div className="saved">
          Saved as v{saveState.version}.{saveState.warnings.length > 0 && " Warnings:"}
          {saveState.warnings.length > 0 && (
            <ul>
              {saveState.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {saveState.kind === "conflict" && (
        <div className="bad-head">
          Not saved — the map changed: another director saved it{saveState.version !== null ? ` (now v${saveState.version})` : ""} since you loaded it. Reload to get their version, then redo your edits.
          <div className="conflict-actions">
            <button className="w98-button" onClick={onCopyDraft}>
              {copied === "draft" ? "Copied ✔" : "Copy my edits (JSON)"}
            </button>
            <button className="w98-button default" onClick={onReload}>
              Reload the map (discard my edits)
            </button>
          </div>
        </div>
      )}
      {saveState.kind === "error" && (
        <div className="bad-head">
          Not saved — {saveState.error}
          {saveState.problems.length > 0 && (
            <ul>
              {saveState.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
