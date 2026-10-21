//! The map page's inspector: the fields of whatever is selected — a
//! terminal, a duck spot, the spawn, a prop, a room, a door, a stair, a
//! floor or a house speaker (`audio.json`: its outputs, gain, zones, a
//! Test button). Every change goes through the pure ops (`edit.ts`, `doors.ts`,
//! `structure.ts`, `yards.ts`) and lands as one undo step; deleting a room
//! or a floor says first what goes with it.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_SPOT_FOV, DUCK_MAX_RISE, floorById, propSolid, roomById } from "@loom/house";
import type { AudioConfig, Compass, HouseMap, PropKind, Vec3 } from "@loom/house";
import { addSpeaker, addZone, outputLabel, outputUsers, patchSpeaker, removeSpeaker, renameSpeaker, rotateSpeaker, setSpeakerHeight, setSpeakerYaw, setZoneMember, moveSpeaker, speakerById, speakersDropped, toggleSpeakerOutput, withSpeakersText, zonesOf } from "./audio.ts";
import type { StoryLocation } from "./check.ts";
import { DOOR_WIDTH, openEdge, patchDoor, resolveDoor } from "./doors.ts";
import { addDuckSpot, addTerminal, moveTo, patchRoom, patchTerminal, positionOf, provisionLink, removeThing, setHeight, setYaw, yawOf, type Selection } from "./edit.ts";
import { metres, rectOf } from "./plan.ts";
import { guardableDoors, guardedBy, onFloor, patchProp, PROP_KINDS, rotateBy, setGuard, snapTerminalToWall, TERMINAL_VIEW_HINTS, TERMINAL_VIEWS, YAW_STEP, type TerminalViewName } from "./props.ts";
import { cascadeOf, cascadeText, deleteRoomText, deletesWith, patchFloor, patchStair, removeFloor, removeRoom, renameRoom, setRoomRect, stairCandidates } from "./structure.ts";
import { fillYard, patchYard, yardClash, yardOf } from "./yards.ts";
import { commitPending, isStep, parseNum } from "./tools.ts";

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
export function CommitText({ label, value, disabled, onCommit, list, placeholder, children }: { label: ReactNode; value: string; disabled: boolean; onCommit: (v: string) => void; list?: string; placeholder?: string; children?: ReactNode }) {
  const [text, setText] = useState(value);
  /** The text Enter / blur last committed (the unmount never lands it again). */
  const committed = useRef<string | null>(null);
  useEffect(() => {
    setText(value);
    committed.current = null;
  }, [value]);
  // Read at unmount, not at render: the blur that committed may not have re-rendered this field.
  useCommitOnUnmount(text !== value ? () => commitPending(text, value, committed.current) && onCommit(text) : null);
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
        onBlur={() => {
          if (!commitPending(text, value, null)) return;
          committed.current = text;
          onCommit(text);
        }}
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
  /** The house speakers (null: the server has no speaker routes). */
  audio?: AudioConfig | null;
  /** The speakers as last saved (a Test needs the speaker saved). */
  savedAudio?: AudioConfig | null;
  commitAudio?: (a: AudioConfig) => void;
  /** Play the identifying tone on a speaker / output (stagehand's router). */
  onTest?: (target: { speaker: string } | { out: number }) => void;
}

export function Inspector(props: InspectorProps) {
  const { house, sel, edit, commit, onSelect, onNotice } = props;
  if (sel === null) {
    return (
      <p className="muted">
        Click a room, a door, a terminal, a speaker, a duck spot or the spawn. Tick <b>Edit</b> to change the map: draw rooms and yards, click walls for doors, and type exact sizes here.
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
  const yawField =
    yaw === null ? null : (
      <span className="yaw-field">
        <Num label="yaw °" value={yaw} step={5} disabled={!edit} onChange={(v) => v !== null && commit(setYaw(house, sel, v))} />
        {edit && (
          <span className="button-row tight">
            <button className="w98-button small" onClick={() => commit(rotateBy(house, sel, YAW_STEP))} title={`Turn ${YAW_STEP}° (R)`}>
              ⟲ {YAW_STEP}°
            </button>
            <button className="w98-button small" onClick={() => commit(rotateBy(house, sel, -YAW_STEP))} title={`Turn −${YAW_STEP}° (⇧R)`}>
              ⟳ {YAW_STEP}°
            </button>
          </span>
        )}
      </span>
    );
  const floorButton = edit ? (
    <button className="w98-button small" onClick={() => commit(onFloor(house, sel))} title="Put it back on its room's floor (y = the floor's elevation)">
      On floor
    </button>
  ) : null;
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
    case "terminal":
      return <TerminalInspector key={sel.id} {...props} id={sel.id} posFields={posFields} yawField={yawField} remove={remove("terminal")} />;
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
    case "prop":
      return <PropInspector key={sel.id} {...props} id={sel.id} posFields={posFields} yawField={yawField} floorButton={floorButton} remove={remove("prop")} />;
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
            {d.guard !== undefined && (
              <>
                {" "}
                · guarded by <code>{d.guard}</code> (shut until that King falls; set on the King)
              </>
            )}
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
    case "speaker":
      return <SpeakerInspector key={sel.id} {...props} id={sel.id} />;
  }
}

interface PartsProps {
  id: string;
  posFields: ReactNode;
  yawField: ReactNode;
  remove: ReactNode;
}

function TerminalInspector({ house, edit, commit, onNotice, origin, copy, copied, id, posFields, yawField, remove }: InspectorProps & PartsProps) {
  const t = house.terminals.find((x) => x.id === id);
  if (t === undefined) return null;
  const roomName = roomById(house, t.room)?.label ?? t.room;
  const location = roomById(house, t.room)?.location?.trim() || roomName;
  const view: TerminalViewName = t.view ?? "auto";
  const roomless = view === "tv" || view === "chess" || view === "casino";
  const link = provisionLink(origin, t);
  return (
    <div className="inspect">
      <h3>🖥 Terminal</h3>
      <div className="kv">
        id <code>{t.id}</code> · in {roomName}
      </div>
      <label className="field">
        name
        <input className="w98-input" value={t.name} disabled={!edit} onChange={(e) => commit(patchTerminal(house, t.id, { name: e.target.value }))} />
      </label>
      {posFields}
      <div className="num-row">
        {yawField}
        <Num label="pitch °" value={t.pitch ?? 0} step={5} disabled={!edit} onChange={(v) => commit(patchTerminal(house, t.id, { pitch: v === null || v === 0 ? undefined : Math.max(-89, Math.min(89, v)) }))} />
        <Num
          label="fov ° (vertical)"
          value={t.fov ?? DEFAULT_SPOT_FOV}
          step={5}
          disabled={!edit}
          onChange={(v) => commit(patchTerminal(house, t.id, { fov: v === null || v === DEFAULT_SPOT_FOV ? undefined : Math.max(10, Math.min(150, v)) }))}
        />
      </div>
      {edit && (
        <div className="button-row">
          <button
            className="w98-button"
            onClick={() => {
              const next = snapTerminalToWall(house, t.id);
              if (next === house) return onNotice("It is already on the nearest wall, facing into the room.");
              commit(next);
            }}
            title="Put the screen on its room's nearest wall, facing into the room (a terminal dropped within 40 cm of a wall does this by itself)"
          >
            ⊢ Snap to wall
          </button>
        </div>
      )}
      <label className="field">
        screen <span className="muted">(what the tablet on this spot shows)</span>
        <select className="w98-input" value={view} disabled={!edit} onChange={(e) => commit(patchTerminal(house, t.id, { view: e.target.value as TerminalViewName }))}>
          {TERMINAL_VIEWS.map((v) => (
            <option key={v} value={v}>
              {TERMINAL_VIEW_HINTS[v]}
            </option>
          ))}
        </select>
      </label>
      <label className="field check" title={roomless ? "The TV, the chess board and the casino belong to no room" : "Asleep until the story opens this room to everyone, then it speaks the character's lines said there"}>
        <input type="checkbox" checked={t.speaks === true && !roomless} disabled={!edit || roomless} onChange={(e) => commit(patchTerminal(house, t.id, { speaks: e.target.checked }))} />
        room terminal (speaks for {location})
      </label>
      <div className="field">
        provisioning link <span className="muted">(add <code>&amp;code=&lt;mod passcode&gt;</code>; the tablet takes its name, screen and room from here — or open <code>/terminal/</code> and tap this terminal)</span>
        <div className="link-row">
          <input className="w98-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button className="w98-button" onClick={() => copy(`i-${t.id}`, link)}>
            {copied === `i-${t.id}` ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {remove}
    </div>
  );
}

function PropInspector({ house, edit, commit, id, posFields, yawField, floorButton, remove }: InspectorProps & PartsProps & { floorButton: ReactNode }) {
  const p = house.props.find((x) => x.id === id);
  if (p === undefined) return null;
  const roomName = roomById(house, p.room)?.label ?? p.room;
  const setSize = (i: number, v: number | null) => {
    if (v === null || !(v > 0)) return;
    const size = [...p.size] as Vec3;
    size[i] = v;
    commit(patchProp(house, p.id, { size }));
  };
  const guarded = guardedBy(house, p.id);
  return (
    <div className="inspect">
      <h3>{p.kind === "king" ? "♔ King" : "▦ Prop"}</h3>
      <div className="kv">
        id <code>{p.id}</code> · in {roomName}
      </div>
      <div className="num-row">
        <label className="field">
          kind
          <select className="w98-input" value={p.kind} disabled={!edit} onChange={(e) => commit(patchProp(house, p.id, { kind: e.target.value as PropKind }))}>
            {PROP_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="num">
          colour
          <input className="w98-input" type="color" value={p.color ?? "#999999"} disabled={!edit} onChange={(e) => commit(patchProp(house, p.id, { color: e.target.value }))} />
        </label>
        <label className="radio checkbox">
          <input type="checkbox" checked={propSolid(p)} disabled={!edit} onChange={(e) => {
              // The kind's default (box / cylinder / king collide) is left unwritten.
              const byDefault = propSolid({ ...p, solid: undefined });
              commit(patchProp(house, p.id, { solid: e.target.checked === byDefault ? undefined : e.target.checked }));
            }} /> solid
        </label>
      </div>
      <CommitText label="label" value={p.label ?? ""} disabled={!edit} placeholder="(none)" onCommit={(v) => commit(patchProp(house, p.id, { label: v.trim() === "" ? undefined : v }))} />
      <div className="num-row">
        <Num label="W (x) m" value={p.size[0]} disabled={!edit} onChange={(v) => setSize(0, v)} />
        <Num label="H (y) m" value={p.size[1]} disabled={!edit} onChange={(v) => setSize(1, v)} />
        <Num label="D (z) m" value={p.size[2]} disabled={!edit} onChange={(v) => setSize(2, v)} />
      </div>
      {posFields}
      <div className="num-row">
        {yawField}
        {floorButton}
      </div>
      {p.kind === "king" && (
        <>
          <div className="num-row">
            <Num label="hp (max, 1–99)" value={p.hp ?? 4} step={1} disabled={!edit} onChange={(v) => v !== null && commit(patchProp(house, p.id, { hp: v }))} />
            <label className="field">
              guards door
              <select className="w98-input" value={guarded[0] ?? ""} disabled={!edit} onChange={(e) => commit(setGuard(house, p.id, e.target.value === "" ? null : e.target.value))}>
                <option value="">(no door)</option>
                {guardableDoors(house, p.id).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id} · {roomById(house, d.a)?.label ?? d.a} ↔ {d.b === null ? "outside" : (roomById(house, d.b)?.label ?? d.b)}
                    {d.guard !== undefined && d.guard !== p.id ? ` (now ${d.guard}'s)` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">
            ♔ One bar shared by every program, one hit a reinstallation{p.health !== undefined ? ` (the bar lives in ${p.health})` : ""} · a hit posts {p.signals?.hit ?? "king hit"}, 0 posts {p.signals?.fallen ?? "king fallen"}
            {p.armed !== undefined ? ` · his chess counts while ${p.armed.path} ≥ ${p.armed.min}` : ""}. His guarded door stays shut until he falls. Health, signals and armed are edited in the JSON tab.
          </p>
        </>
      )}
      <p className="muted small">Drag it on the plan (⌥ no snap); the round handle, R / ⇧R or ⌥-wheel turns it; ⌘D duplicates.</p>
      {remove}
    </div>
  );
}

function RoomInspector({ house, edit, locations, commit, onSelect, onNotice, id, audio = null, commitAudio }: InspectorProps & { id: string }) {
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
    const out = removeRoom(house, r.id);
    if ("error" in out) return onNotice(out.error);
    // The speakers the delete takes (a yard's too: one standing in no piece goes).
    if (!window.confirm(withSpeakersText(deleteRoomText(r, c), audio === null ? 0 : speakersDropped(house, out.house, audio).length))) return;
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
          {audio !== null && commitAudio !== undefined && (
            <button
              className="w98-button"
              onClick={() => {
                const out = addSpeaker(audio, house, r.id);
                commitAudio(out.audio);
                onSelect({ kind: "speaker", id: out.id });
              }}
              title="Hang a house speaker in this room (saved in audio.json, not the map)"
            >
              + Speaker here
            </button>
          )}
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

function FloorInspector({ house, edit, commit, onSelect, onNotice, id, audio = null }: InspectorProps & { id: string }) {
  const f = floorById(house, id);
  if (f === undefined) return null;
  const rooms = house.rooms.filter((r) => r.floor === id);
  const remove = () => {
    const c = cascadeOf(house, rooms.map((r) => r.id));
    if (house.floors.length <= 1) return onNotice("A house needs at least one floor.");
    if (c.spawn) return onNotice("The spawn is on this floor — move it to another floor first.");
    const extra = cascadeText(c, true);
    const out = removeFloor(house, id);
    if ("error" in out) return onNotice(out.error);
    if (!window.confirm(withSpeakersText(`Delete the floor “${f.label}”${extra !== "" ? ` with ${extra}` : ""}?`, audio === null ? 0 : speakersDropped(house, out.house, audio).length))) return;
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

function SpeakerInspector({ house, edit, onSelect, onNotice, id, audio = null, savedAudio = null, commitAudio, onTest }: InspectorProps & { id: string }) {
  const s = audio === null ? undefined : speakerById(audio, id);
  if (audio === null || s === undefined || commitAudio === undefined) return null;
  const commit = commitAudio;
  const room = roomById(house, s.room);
  const floor = room !== undefined ? floorById(house, room.floor) : undefined;
  const saved = savedAudio !== null && speakerById(savedAudio, id) !== undefined;
  const chans = Array.from({ length: audio.device.outputs }, (_, i) => i + 1);
  const mine = zonesOf(audio, id);
  return (
    <div className="inspect">
      <h3>🔊 Speaker</h3>
      <div className="kv">
        in {room?.label ?? <b className="bad-text">{s.room} (not on the map)</b>}
        {floor !== undefined && <> · {floor.label}</>} <span className="muted">(the room follows where it stands)</span>
      </div>
      <CommitText label="name" value={s.name} disabled={!edit} onCommit={(v) => commit(patchSpeaker(audio, id, { name: v }))} />
      <CommitText
        label="id (cues, zones and the router refer to it)"
        value={s.id}
        disabled={!edit}
        onCommit={(v) => {
          const next = renameSpeaker(audio, id, v);
          if (next === audio) return onNotice(v.trim() === "" ? "A speaker needs an id." : `The id “${v.trim()}” is taken or reserved.`);
          commit(next);
          onSelect({ kind: "speaker", id: v.trim() });
        }}
      />
      <div className="num-row">
        <Num label="x" value={s.pos.x} disabled={!edit} onChange={(v) => v !== null && commit(moveSpeaker(audio, house, id, [v, s.pos.z]))} />
        <Num label="y (height)" value={s.pos.y} disabled={!edit} onChange={(v) => v !== null && commit(setSpeakerHeight(audio, id, v))} />
        <Num label="z" value={s.pos.z} disabled={!edit} onChange={(v) => v !== null && commit(moveSpeaker(audio, house, id, [s.pos.x, v]))} />
      </div>
      <div className="num-row">
        <span className="yaw-field">
          <Num label="yaw °" value={s.yaw} step={5} disabled={!edit} onChange={(v) => v !== null && commit(setSpeakerYaw(audio, id, v))} />
          {edit && (
            <span className="button-row tight">
              <button className="w98-button small" onClick={() => commit(rotateSpeaker(audio, id, YAW_STEP))} title={`Turn ${YAW_STEP}° (R)`}>
                ⟲ {YAW_STEP}°
              </button>
              <button className="w98-button small" onClick={() => commit(rotateSpeaker(audio, id, -YAW_STEP))} title={`Turn −${YAW_STEP}° (⇧R)`}>
                ⟳ {YAW_STEP}°
              </button>
            </span>
          )}
        </span>
        <Num label="gain dB" value={s.gain ?? 0} step={1} disabled={!edit} onChange={(v) => commit(patchSpeaker(audio, id, { gain: v ?? undefined }))} />
      </div>
      <div className="field">
        outputs <span className="muted">(the interface's channels feeding it)</span>
        <div className="out-pick" role="group" aria-label="Outputs">
          {chans.map((ch) => {
            const on = s.out.includes(ch);
            const others = outputUsers(audio, ch).filter((x) => x.id !== id);
            return (
              <button
                key={ch}
                className={`w98-button small out-chip${on ? " pressed" : ""}${others.length > 0 ? " shared" : ""}`}
                aria-pressed={on}
                disabled={!edit}
                onClick={() => commit(toggleSpeakerOutput(audio, id, ch))}
                title={`${ch} · ${outputLabel(audio, ch)}${others.length > 0 ? ` — also feeds ${others.map((x) => x.name).join(", ")}` : ""}`}
              >
                {ch}
              </button>
            );
          })}
        </div>
        <div className="muted small">{s.out.length === 0 ? "No output: nothing plays on it." : s.out.map((ch) => `${ch} ${outputLabel(audio, ch)}`).join(" · ")}</div>
      </div>
      <div className="field">
        zones
        {audio.zones.length === 0 && <span className="muted small">No zones yet.</span>}
        <div className="zone-pick">
          {audio.zones.map((z) => (
            <label key={z.id} className="radio checkbox">
              <input type="checkbox" checked={mine.includes(z.id)} disabled={!edit} onChange={(e) => commit(setZoneMember(audio, z.id, id, e.target.checked))} /> {z.name}
            </label>
          ))}
        </div>
        {edit && (
          <button className="w98-button small" onClick={() => commit(addZone(audio, room?.label ?? "Zone", [id]).audio)} title="A new zone with this speaker in it (rename it in the Audio tab)">
            + New zone with it
          </button>
        )}
      </div>
      <div className="button-row">
        <button className="w98-button" disabled={onTest === undefined || !saved} onClick={() => onTest?.({ speaker: id })} title={saved ? "The router plays a short tone and says its name on this speaker" : "Save the speakers first — the router only knows saved ones"}>
          🔈 Test{saved ? "" : " (save first)"}
        </button>
        {edit && (
          <button
            className="w98-button"
            onClick={() => {
              commit(removeSpeaker(audio, id));
              onSelect(null);
            }}
          >
            Delete speaker
          </button>
        )}
      </div>
      <p className="muted small">Drag it on the plan (⌥ no snap); the round handle, R / ⇧R or ⌥-wheel turns it; ⌘D duplicates; arrows nudge. Speakers are saved in audio.json with 💾 Save, never in the map.</p>
    </div>
  );
}
