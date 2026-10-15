//! The map page's inspector: the fields of whatever is selected — a
//! terminal, a duck spot, the spawn, a prop, a room, a door, a stair or a
//! floor. Every change goes through the pure ops (`edit.ts`, `doors.ts`,
//! `structure.ts`, `yards.ts`) and lands as one undo step; deleting a room
//! or a floor says first what goes with it.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_SPOT_FOV, DUCK_MAX_RISE, floorById, roomById } from "@loom/house";
import type { Compass, HouseMap } from "@loom/house";
import type { StoryLocation } from "./check.ts";
import { DOOR_WIDTH, openEdge, patchDoor, resolveDoor } from "./doors.ts";
import { addDuckSpot, addTerminal, moveTo, patchRoom, patchTerminal, positionOf, provisionLink, removeThing, setHeight, setYaw, yawOf, type Selection } from "./edit.ts";
import { metres, rectOf } from "./plan.ts";
import { cascadeOf, cascadeText, deleteRoomText, deletesWith, patchFloor, patchStair, removeFloor, removeRoom, renameRoom, setRoomRect, stairCandidates } from "./structure.ts";
import { fillYard, patchYard, yardClash, yardOf } from "./yards.ts";
import { isStep, parseNum } from "./tools.ts";

/** A field typed into and then unmounted (the selection moved on before it blurred) still lands what was typed. */
function useCommitOnUnmount(pending: (() => void) | null): void {
  const ref = useRef(pending);
  ref.current = pending;
  useEffect(() => () => ref.current?.(), []);
}

/**
 * A number field that commits on Enter / blur — a typed number passes
 * through every prefix of itself ("10.5" is 1, then 10, …), and each of
 * those applied would be a real resize, leaving doors clamped and yards
 * re-cut by values nobody meant. A step (the spinner, ↑ / ↓) is a whole
 * value and lands at once. Esc puts the field back.
 */
export function Num({ label, value, onChange, step = 0.05, disabled, placeholder }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; disabled: boolean; placeholder?: string }) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = (t: string) => {
    if (t === shown) return;
    const v = parseNum(t);
    // Back to the value shown: the edit (if it changed anything) re-renders it.
    setText(shown);
    if (v !== undefined) onChange(v);
  };
  useCommitOnUnmount(text !== shown ? () => commit(text) : null);
  return (
    <label className="num">
      {label}
      <input
        className="w98-input"
        type="number"
        step={step}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          if (isStep(e.nativeEvent)) commit(e.target.value);
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          else if (e.key === "Escape") setText(shown);
        }}
      />
    </label>
  );
}

/** A text field that commits on Enter / blur (ids: renaming on every keystroke would churn references; a yard's label: its pieces are grouped by it). */
function CommitText({ label, value, disabled, onCommit, list, placeholder, children }: { label: ReactNode; value: string; disabled: boolean; onCommit: (v: string) => void; list?: string; placeholder?: string; children?: ReactNode }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useCommitOnUnmount(text !== value ? () => onCommit(text) : null);
  return (
    <label className="field">
      {label}
      <input
        className="w98-input"
        value={text}
        disabled={disabled}
        {...(list !== undefined ? { list } : {})}
        {...(placeholder !== undefined ? { placeholder } : {})}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          else if (e.key === "Escape") setText(value);
        }}
      />
      {children}
    </label>
  );
}

export interface InspectorProps {
  house: HouseMap;
  sel: Selection | null;
  edit: boolean;
  /** The story's LOCATIONs (null: unknown — the picker offers the names already used). */
  locations: StoryLocation[] | null;
  commit: (h: HouseMap) => void;
  onSelect: (sel: Selection | null) => void;
  onNotice: (text: string) => void;
  origin: string;
  copy: (key: string, value: string) => void;
  copied: string | null;
}

export function Inspector(props: InspectorProps) {
  const { house, sel, edit, commit, onSelect, onNotice } = props;
  if (sel === null) {
    return (
      <p className="muted">
        Click a room, a door, a terminal, a duck spot or the spawn. Tick <b>Edit</b> to change the map: draw rooms and yards, click walls for doors, and type exact sizes here.
      </p>
    );
  }
  const pos = positionOf(house, sel);
  const posFields =
    pos === null ? null : (
      <div className="num-row">
        <Num label="x" value={pos[0]} disabled={!edit} onChange={(v) => v !== null && commit(moveTo(house, sel, [v, pos[2]]))} />
        <Num label="y" value={pos[1]} disabled={!edit} onChange={(v) => v !== null && commit(setHeight(house, sel, v))} />
        <Num label="z" value={pos[2]} disabled={!edit} onChange={(v) => v !== null && commit(moveTo(house, sel, [pos[0], v]))} />
      </div>
    );
  const yaw = yawOf(house, sel);
  const yawField = yaw === null ? null : <Num label="yaw °" value={yaw} step={5} disabled={!edit} onChange={(v) => v !== null && commit(setYaw(house, sel, v))} />;
  const remove = (what: string) =>
    edit ? (
      <button
        className="w98-button"
        onClick={() => {
          const next = removeThing(house, sel);
          if (next === house) return onNotice(`This ${what} can't be removed${sel.kind === "duck" ? " — a map needs at least one duck spot" : ""}.`);
          commit(next);
          onSelect(null);
        }}
      >
        Delete {what}
      </button>
    ) : null;
  const roomName = (id: string | null) => (id === null ? "outside" : (roomById(house, id)?.label ?? id));

  switch (sel.kind) {
    case "terminal": {
      const t = house.terminals.find((x) => x.id === sel.id);
      if (t === undefined) return null;
      const link = provisionLink(props.origin, t);
      return (
        <div className="inspect">
          <h3>🖥 Terminal</h3>
          <div className="kv">
            id <code>{t.id}</code> · in {roomName(t.room)}
          </div>
          <label className="field">
            name
            <input className="w98-input" value={t.name} disabled={!edit} onChange={(e) => commit(patchTerminal(house, t.id, { name: e.target.value }))} />
          </label>
          {posFields}
          <div className="num-row">
            {yawField}
            <Num label="pitch °" value={t.pitch ?? 0} step={5} disabled={!edit} onChange={(v) => commit(patchTerminal(house, t.id, { pitch: v === null || v === 0 ? undefined : v }))} />
            <Num
              label="fov ° (vertical)"
              value={t.fov ?? DEFAULT_SPOT_FOV}
              step={5}
              disabled={!edit}
              onChange={(v) => commit(patchTerminal(house, t.id, { fov: v === null || v === DEFAULT_SPOT_FOV ? undefined : Math.max(10, Math.min(150, v)) }))}
            />
          </div>
          <div className="field">
            provisioning link <span className="muted">(add <code>&amp;code=&lt;mod passcode&gt;</code>)</span>
            <div className="link-row">
              <input className="w98-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button className="w98-button" onClick={() => props.copy(`i-${t.id}`, link)}>
                {props.copied === `i-${t.id}` ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          {remove("terminal")}
        </div>
      );
    }
    case "duck": {
      const d = house.duck.spots.find((x) => x.id === sel.id);
      if (d === undefined) return null;
      return (
        <div className="inspect">
          <h3>🦆 Duck spot</h3>
          <div className="kv">
            id <code>{d.id}</code> · in {roomName(d.room)}
          </div>
          {posFields}
          <p className="muted small">y is where Gerald's feet are (raise it to sit him on a counter — at most {DUCK_MAX_RISE} m above the floor, or players can't reach him).</p>
          {house.duck.spots.length > 1 && remove("duck spot")}
        </div>
      );
    }
    case "spawn":
      return (
        <div className="inspect">
          <h3>★ Spawn</h3>
          <div className="kv">in {roomName(house.spawn.room)}</div>
          {posFields}
          {yawField}
          <p className="muted small">Where every program starts, facing the yaw.</p>
        </div>
      );
    case "prop": {
      const p = house.props.find((x) => x.id === sel.id);
      if (p === undefined) return null;
      return (
        <div className="inspect">
          <h3>▦ Prop</h3>
          <div className="kv">
            id <code>{p.id}</code> · {p.kind} · {p.size.join(" × ")} m{p.label !== undefined ? ` · “${p.label}”` : ""} · in {roomName(p.room)}
          </div>
          {posFields}
          {yawField}
          <p className="muted small">Size, colour and kind are edited in the JSON tab.</p>
          {remove("prop")}
        </div>
      );
    }
    case "room":
      return <RoomInspector key={sel.id} {...props} id={sel.id} />;
    case "door": {
      const d = house.doors.find((x) => x.id === sel.id);
      if (d === undefined) return null;
      const relinked = resolveDoor(house, d);
      return (
        <div className="inspect">
          <h3>▯ Door</h3>
          <div className="kv">
            id <code>{d.id}</code> · {roomName(d.a)} ↔ {roomName(d.b)}
          </div>
          <div className="num-row">
            <Num label="width m" value={d.width} disabled={!edit} onChange={(v) => v !== null && v > 0 && commit(patchDoor(house, d.id, { width: v }))} />
            <Num label="height m" value={d.height ?? null} placeholder={`${house.style?.doorHeight ?? 2}`} disabled={!edit} onChange={(v) => commit(patchDoor(house, d.id, { height: v ?? undefined }))} />
          </div>
          {edit && (
            <div className="button-row">
              <button className="w98-button" onClick={() => commit(openEdge(house, d.id))} title="Make the door as wide as the whole shared stretch of wall — for one yard piece to the next, or an archway">
                Open the whole edge
              </button>
              <button className="w98-button" onClick={() => commit(patchDoor(house, d.id, { width: DOOR_WIDTH }))}>
                {DOOR_WIDTH} m
              </button>
              {relinked !== d && (
                <button className="w98-button" onClick={() => commit({ ...house, doors: house.doors.map((x) => (x.id === d.id ? relinked : x)) })}>
                  Re-link ({roomName(relinked.a)} ↔ {roomName(relinked.b)})
                </button>
              )}
              {remove("door")}
            </div>
          )}
          <p className="muted small">Drag the door along its wall; the rooms either side are read off the plan. A door with one room beside it opens to the outside.</p>
        </div>
      );
    }
    case "stair": {
      const s = house.stairs.find((x) => x.id === sel.id);
      if (s === undefined) return null;
      const cands = stairCandidates(house, s);
      const floorOf = (id: string) => floorById(house, roomById(house, id)?.floor ?? "")?.label ?? "?";
      const roomPick = (key: "from" | "to") => (
        <label className="field">
          {key === "from" ? "from (the lower room — the foot)" : "to (the upper room — the head)"}
          <select className="w98-input" value={s[key]} disabled={!edit} onChange={(e) => commit(patchStair(house, s.id, { [key]: e.target.value }))}>
            {!cands.some((r) => r.id === s[key]) && <option value={s[key]}>{s[key] || "(choose)"}</option>}
            {cands.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} · {floorOf(r.id)}
              </option>
            ))}
          </select>
        </label>
      );
      const [x0, z0, x1, z1] = s.rect;
      const setRect = (i: number, v: number | null) => {
        if (v === null) return;
        const r = [...s.rect] as typeof s.rect;
        r[i] = v;
        commit(patchStair(house, s.id, { rect: r }));
      };
      return (
        <div className="inspect">
          <h3>▤ Stairs</h3>
          <div className="kv">
            id <code>{s.id}</code> · {metres(x1 - x0)} × {metres(z1 - z0)}
          </div>
          {roomPick("from")}
          {roomPick("to")}
          <label className="field">
            rises toward
            <select className="w98-input" value={s.up} disabled={!edit} onChange={(e) => commit(patchStair(house, s.id, { up: e.target.value as Compass }))}>
              <option value="n">north ↑</option>
              <option value="s">south ↓</option>
              <option value="e">east →</option>
              <option value="w">west ←</option>
            </select>
          </label>
          <div className="num-row">
            <Num label="x0" value={x0} disabled={!edit} onChange={(v) => setRect(0, v)} />
            <Num label="z0" value={z0} disabled={!edit} onChange={(v) => setRect(1, v)} />
            <Num label="x1" value={x1} disabled={!edit} onChange={(v) => setRect(2, v)} />
            <Num label="z1" value={z1} disabled={!edit} onChange={(v) => setRect(3, v)} />
          </div>
          <p className="muted small">The rect must sit inside both rooms, with 30 cm of floor beyond its foot and its head. The upper floor gets a hole and rails on three sides.</p>
          {remove("stair")}
        </div>
      );
    }
    case "floor":
      return <FloorInspector key={sel.id} {...props} id={sel.id} />;
  }
}

function RoomInspector({ house, edit, locations, commit, onSelect, onNotice, id }: InspectorProps & { id: string }) {
  const r = roomById(house, id);
  if (r === undefined) return null;
  const rect = rectOf(r.poly);
  const floor = floorById(house, r.floor);
  const names = locations !== null ? locations.map((l) => l.id) : [...new Set(house.rooms.flatMap((x) => (x.location !== undefined ? [x.location] : [])))];
  const listId = `locations-${r.id}`;
  const pieces = r.outdoor ? yardOf(house, r.id) : [];
  const setRect = (i: number, v: number | null) => {
    if (rect === null || v === null) return;
    const [x0, z0, x1, z1] = rect;
    const w = x1 - x0;
    const d = z1 - z0;
    // x / z move the room (its size kept); W / D grow it east / south.
    const to: [number, number, number, number] = i === 0 ? [v, z0, v + w, z1] : i === 1 ? [x0, v, x1, v + d] : i === 2 ? [x0, z0, x0 + Math.max(0.3, v), z1] : [x0, z0, x1, z0 + Math.max(0.3, v)];
    commit(setRoomRect(house, r.id, to));
  };
  const remove = () => {
    const c = cascadeOf(house, deletesWith(house, r.id));
    if (c.spawn) return onNotice(`The spawn is in this ${r.outdoor ? "yard" : "room"} — move the spawn to another room first.`);
    if (!window.confirm(deleteRoomText(r, c))) return;
    const out = removeRoom(house, r.id);
    if ("error" in out) return onNotice(out.error);
    commit(out.house);
    onSelect(null);
  };
  /** Label / LOCATION: never into another yard's (its pieces would merge with this one's). */
  const patchNamed = (patch: { label?: string; location?: string }) => {
    if (yardClash(house, r.id, patch)) return onNotice(`Another yard on this floor is already “${patch.label ?? r.label}”${(patch.location ?? r.location) ? ` (${patch.location ?? r.location})` : ""} — two yards with one name would merge into one. Pick another name.`);
    commit(patchYard(house, r.id, patch));
  };
  const add = (kind: "terminal" | "duck") => {
    const out = kind === "terminal" ? addTerminal(house, r.id) : addDuckSpot(house, r.id);
    commit(out.house);
    onSelect({ kind, id: out.id });
  };
  return (
    <div className="inspect">
      <h3>{r.outdoor ? "▒ Yard" : "⌂ Room"}</h3>
      <div className="kv">
        {floor?.label ?? r.floor} · {rect !== null ? `${metres(rect[2] - rect[0])} × ${metres(rect[3] - rect[1])}` : `${r.poly.length}-sided`}
        {pieces.length > 1 && ` · 1 of ${pieces.length} pieces`}
      </div>
      <CommitText label="label" value={r.label} disabled={!edit} onCommit={(v) => patchNamed({ label: v })} />
      <CommitText
        label="id (doors, terminals and the games refer to it)"
        value={r.id}
        disabled={!edit}
        onCommit={(v) => {
          const next = renameRoom(house, r.id, v);
          if (next === house) return onNotice(v.trim() === "" ? "A room needs an id." : `The id “${v.trim()}” is taken.`);
          commit(next);
          onSelect({ kind: "room", id: v.trim() });
        }}
      />
      <CommitText
        label={<>story LOCATION{locations === null && <span className="muted"> (the story isn't loaded — names used so far)</span>}</>}
        value={r.location ?? ""}
        disabled={!edit}
        list={listId}
        placeholder="(none) — pick a LOCATION"
        onCommit={(v) => patchNamed({ location: v })}
      >
        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </CommitText>
      <div className="num-row">
        <label className="num">
          floor tint
          <input className="w98-input" type="color" value={r.color ?? "#c0c0c0"} disabled={!edit} onChange={(e) => commit(patchYard(house, r.id, { color: e.target.value }))} />
        </label>
        <Num label="height m" value={r.height ?? null} placeholder={`${floor?.height ?? ""}`} disabled={!edit || r.outdoor === true} onChange={(v) => commit(patchRoom(house, r.id, { height: v ?? undefined }))} />
      </div>
      <label className="radio checkbox">
        <input
          type="checkbox"
          checked={r.outdoor === true}
          disabled={!edit}
          onChange={(e) => {
            if (!e.target.checked && pieces.length > 1) return onNotice(`This yard is cut into ${pieces.length} pieces around the rooms in it, so it can't become one indoor room — delete it and draw a room instead.`);
            commit(patchRoom(house, r.id, { outdoor: e.target.checked }));
          }}
        />{" "}
        Outdoor (yard — no roof, fences)
      </label>
      {rect !== null && pieces.length < 2 && (
        <div className="num-row">
          <Num label="x (west)" value={rect[0]} disabled={!edit} onChange={(v) => setRect(0, v)} />
          <Num label="z (north)" value={rect[1]} disabled={!edit} onChange={(v) => setRect(1, v)} />
          <Num label="W (x) m" value={Number((rect[2] - rect[0]).toFixed(3))} disabled={!edit} onChange={(v) => setRect(2, v)} />
          <Num label="D (z) m" value={Number((rect[3] - rect[1]).toFixed(3))} disabled={!edit} onChange={(v) => setRect(3, v)} />
        </div>
      )}
      {edit && (
        <div className="button-row">
          <button className="w98-button" onClick={() => add("terminal")}>
            + Terminal here
          </button>
          <button className="w98-button" onClick={() => add("duck")}>
            + Duck spot here
          </button>
          {r.outdoor && (
            <button className="w98-button" onClick={() => commit(fillYard(house, r.id))} title="Re-cut the yard as its whole bounding box minus the rooms standing in it">
              Fill the yard
            </button>
          )}
          <button className="w98-button" onClick={remove}>
            {r.outdoor ? "Delete yard…" : "Delete room…"}
          </button>
        </div>
      )}
      <p className="muted small">
        {edit
          ? pieces.length > 1
            ? "A yard cut around the rooms in it: move or resize those rooms (the yard follows), or Fill the yard. Deleting it deletes every piece."
            : rect !== null
            ? "Drag the room to move it (with what stands in it and its doors); drag an edge to resize. Drawn over a yard, an indoor room is cut out of it with a door in."
            : "A polygon room: drag it to move it; its shape is edited in the JSON tab."
          : "Tick Edit to change it."}
      </p>
    </div>
  );
}

function FloorInspector({ house, edit, commit, onSelect, onNotice, id }: InspectorProps & { id: string }) {
  const f = floorById(house, id);
  if (f === undefined) return null;
  const rooms = house.rooms.filter((r) => r.floor === id);
  const remove = () => {
    const c = cascadeOf(house, rooms.map((r) => r.id));
    if (house.floors.length <= 1) return onNotice("A house needs at least one floor.");
    if (c.spawn) return onNotice("The spawn is on this floor — move it to another floor first.");
    const extra = cascadeText(c, true);
    if (!window.confirm(`Delete the floor “${f.label}”${extra !== "" ? ` with ${extra}` : ""}?`)) return;
    const out = removeFloor(house, id);
    if ("error" in out) return onNotice(out.error);
    commit(out.house);
    onSelect(null);
  };
  const row = (children: ReactNode) => <div className="num-row">{children}</div>;
  return (
    <div className="inspect">
      <h3>☰ Floor</h3>
      <div className="kv">
        id <code>{f.id}</code> · {rooms.length} room{rooms.length === 1 ? "" : "s"}
      </div>
      <label className="field">
        label
        <input className="w98-input" value={f.label} disabled={!edit} onChange={(e) => commit(patchFloor(house, id, { label: e.target.value }))} />
      </label>
      {row(
        <>
          <Num label="elevation m (floor surface)" value={f.elevation} disabled={!edit} onChange={(v) => v !== null && commit(patchFloor(house, id, { elevation: v }))} />
          <Num label="height m (ceiling)" value={f.height} disabled={!edit} onChange={(v) => v !== null && v > 0 && commit(patchFloor(house, id, { height: v }))} />
        </>,
      )}
      <p className="muted small">Elevation is the floor surface's height above the origin (the front door's threshold): 0 for the ground floor, negative for a basement. Things on the floor move with it.</p>
      {edit && (
        <button className="w98-button" onClick={remove}>
          Delete floor…
        </button>
      )}
    </div>
  );
}
