//! The house map page (`/reinstall/map`, §3): the plan of one floor at a
//! time — rooms, walls, doors, stairs, props, the terminals with their view
//! cones, the duck spots and the spawn — with every program in the
//! simulation live on it (and the duck it is hunting). Directors switch to
//! **Edit** to drag terminals / duck spots / the spawn, aim them (the
//! rotate handle or the mouse wheel), add and remove terminals and duck
//! spots, move and resize rectangular rooms, or edit the JSON directly —
//! every draft is checked with `validateHouse` as it changes — and save it
//! to the event (`POST /api/mod/spatial/house`).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { buildWalls, DEFAULT_SPOT_FOV, DUCK_MAX_RISE, roomById, validateHouse, wallEnds } from "@loom/house";
import type { HouseMap, PlayerState, Vec2, WallSegment } from "@loom/house";
import { Setup } from "../app.tsx";
import { fetchHouse, saveHouse, streamUrl, tokenAlive, type LoadedHouse } from "../api.ts";
import { baseOf, dropConfig, loadConfig, saveConfig, type ReinstallConfig } from "../config.ts";
import { applyFrame, houseVersionOf, openSpatialStream } from "../spatial.ts";
import { Desktop, Window } from "../wizard.tsx";
import {
  addDuckSpot,
  addTerminal,
  aimAt,
  draftFromText,
  editableSource,
  moveRectEdge,
  moveRoom,
  moveTo,
  patchRoom,
  patchTerminal,
  positionOf,
  provisionLink,
  remoteMapAction,
  removeThing,
  saveBaseOf,
  saveStateOf,
  setHeight,
  setYaw,
  yawOf,
  type SaveState,
  type Selection,
} from "./edit.ts";
import {
  along,
  clientToPlan,
  floorOfRoom,
  hitRectEdge,
  labelSpot,
  planBounds,
  playerColor,
  pointsAttr,
  propCorners,
  rectOf,
  ROOM_TINTS,
  roomUnder,
  snap,
  snap2,
  stairArrow,
  viewBoxOf,
  viewCone,
  type Edge,
} from "./plan.ts";

export function MapApp() {
  const [config, setConfig] = useState<ReinstallConfig | null>(() => loadConfig());
  const [notice, setNotice] = useState<string | null>(null);
  if (config === null) {
    return (
      <Desktop>
        <Setup
          current={null}
          notice={notice ?? "The map needs this device set up with the moderator passcode."}
          onDone={(c) => {
            saveConfig(c);
            setConfig(c);
          }}
          onForget={() => {}}
        />
      </Desktop>
    );
  }
  return (
    <MapEditor
      config={config}
      onRevoked={() => {
        dropConfig();
        setNotice("This device's access was revoked — enter the moderator passcode again.");
        setConfig(null);
      }}
    />
  );
}

/** A key landing in a field that takes text (not a checkbox or a button). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "color", "range"].includes(target.type);
}

type Drag =
  | { kind: "move"; sel: Selection; base: HouseMap; grab: Vec2; origin: Vec2 }
  | { kind: "aim"; sel: Selection; base: HouseMap }
  | { kind: "edge"; room: string; edge: Edge; base: HouseMap }
  | { kind: "room"; room: string; base: HouseMap; grab: Vec2 };

type ViewBox = [number, number, number, number];

type Tab = "inspect" | "terminals" | "players" | "json";

const stringify = (h: HouseMap): string => JSON.stringify(h, null, 2);

function MapEditor({ config, onRevoked }: { config: ReinstallConfig; onRevoked: () => void }) {
  const base = baseOf(config);
  const [loaded, setLoaded] = useState<LoadedHouse | null>(null);
  const [saved, setSaved] = useState<HouseMap | null>(null);
  const [draft, setDraft] = useState<HouseMap | null>(null);
  const [undo, setUndo] = useState<HouseMap[]>([]);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [floor, setFloor] = useState("");
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [tab, setTab] = useState<Tab>("inspect");
  const [players, setPlayers] = useState<ReadonlyMap<string, PlayerState>>(new Map());
  const [live, setLive] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [copied, setCopied] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  /** The plan's frame, frozen for a drag: the pointer maps through the
   *  view the drag started in, or a room dragged past the house's edge
   *  would re-fit the plan under the cursor at every move. */
  const [dragView, setDragView] = useState<ViewBox | null>(null);
  const dragViewRef = useRef<ViewBox | null>(null);
  /** The running drag has pushed its starting map on the undo stack. */
  const dragPushed = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const saving = useRef(false);
  const versionRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  const loadedRef = useRef<LoadedHouse | null>(null);
  const load = useCallback(async () => {
    const l = await fetchHouse(base, config.token);
    // A blip on a reload never swaps the event's map for the stand-in.
    if (l.source === "bundled" && loadedRef.current !== null && loadedRef.current.source !== "bundled") return;
    loadedRef.current = l;
    setLoaded(l);
    versionRef.current = l.version;
    setSaved(l.house);
    setDraft(l.house);
    setText(stringify(l.house));
    setTextError(null);
    setUndo([]);
    setRemoteChanged(false);
    setSaveState((s) => (s.kind === "conflict" ? { kind: "idle" } : s));
    setFloor((f) => (l.house.floors.some((x) => x.id === f) ? f : (l.house.floors[0]?.id ?? "")));
  }, [base, config.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  dirtyRef.current = dirty || textError !== null;

  // The live players, and the map changing under us.
  useEffect(() => {
    const s = openSpatialStream(streamUrl(base, config.token, `Map · ${config.name}`), {
      onFrame: (f) => {
        setPlayers((p) => applyFrame(p, f));
        // A save elsewhere (`house`), or a (re)connect (`hello`): a missed
        // save, or a page that came up on the bundled stand-in, catches up.
        const act = remoteMapAction(houseVersionOf(f), versionRef.current, { saving: saving.current, dirty: dirtyRef.current });
        if (act === "warn") setRemoteChanged(true);
        else if (act === "reload") void load();
      },
      onState: setLive,
      // A refused stream may only be a server that is away: ask before
      // forgetting the device's access.
      onDead: () => void tokenAlive(config).then((ok) => !ok && onRevoked()),
    });
    return () => s.close();
  }, [base, config, load, onRevoked]);

  const validation = useMemo(() => (draft === null ? null : validateHouse(draft)), [draft]);
  const walls = useMemo<WallSegment[]>(() => {
    if (draft === null) return [];
    try {
      return buildWalls(draft);
    } catch {
      return [];
    }
  }, [draft]);
  const liveViewBox = useMemo<ViewBox>(() => viewBoxOf(planBounds(draft ?? saved ?? ({ rooms: [] } as unknown as HouseMap)), 1), [draft, saved]);
  const viewBox = dragView ?? liveViewBox;
  /** Only the event's own map (or the show's, served by the server) is editable. */
  const editable = loaded !== null && editableSource(loaded.source);
  useEffect(() => {
    if (!editable) setEdit(false);
  }, [editable]);

  /** Replace the draft (pushing the old one on the undo stack unless asked not to). */
  const commit = useCallback(
    (next: HouseMap, push = true) => {
      if (draft === null || next === draft) return;
      if (push) setUndo((u) => [...u.slice(-99), draft]);
      setDraft(next);
      setText(stringify(next));
      setTextError(null);
      setSaveState((s) => (s.kind === "ok" ? { kind: "idle" } : s));
    },
    [draft],
  );

  const doUndo = useCallback(() => {
    const prev = undo[undo.length - 1];
    if (prev === undefined) return;
    setUndo(undo.slice(0, -1));
    setDraft(prev);
    setText(stringify(prev));
    setTextError(null);
  }, [undo]);

  /** Back to the saved map — the draft *and* the JSON text (which may be
   *  broken while the draft is not). */
  const revert = () => {
    if (saved === null) return;
    if (draft !== null && draft !== saved) setUndo((u) => [...u.slice(-99), draft]);
    setDraft(saved);
    setText(stringify(saved));
    setTextError(null);
  };

  const save = async () => {
    if (draft === null || !validation?.ok || !editable) return;
    setSaveState({ kind: "saving" });
    saving.current = true;
    try {
      // Based on the version this page loaded: a director who saved in
      // between gets a 409 here instead of being silently overwritten.
      const r = await saveHouse(config, validation.house ?? draft, saveBaseOf(loadedRef.current));
      if (r.ok) {
        versionRef.current = r.result.version;
        setSaved(validation.house ?? draft);
        setDraft(validation.house ?? draft);
        // The next save is based on the version this one made.
        const cur = loadedRef.current;
        if (cur !== null) {
          const next: LoadedHouse = { ...cur, version: r.result.version, source: "event" };
          loadedRef.current = next;
          setLoaded(next);
        }
      } else {
        if (r.status === 401 || r.status === 403) onRevoked();
        // The conflict panel says it all (and offers the reload).
        if (r.conflict) setRemoteChanged(false);
      }
      setSaveState(saveStateOf(r));
    } catch (e) {
      setSaveState({ kind: "error", error: (e as Error).message, problems: [] });
    } finally {
      saving.current = false;
    }
  };

  // --- pointer: drags on the plan --------------------------------------------

  const toPlan = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svg.current?.getBoundingClientRect();
    // During a drag, the frame it started in (the ref: the first move may
    // land before the frozen view has rendered).
    return r ? clientToPlan(e.clientX, e.clientY, r, dragViewRef.current ?? viewBox) : [0, 0];
  };

  const startDrag = (e: ReactPointerEvent, d: Drag) => {
    if (!edit) return;
    e.stopPropagation();
    e.preventDefault();
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = d;
    dragPushed.current = false;
    dragViewRef.current = viewBox;
    setDragView(viewBox);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d === null) return;
    const p = toPlan(e);
    let next: HouseMap;
    switch (d.kind) {
      case "move": {
        const at = snap2([d.origin[0] + p[0] - d.grab[0], d.origin[1] + p[1] - d.grab[1]]);
        next = moveTo(d.base, d.sel, at);
        break;
      }
      case "aim":
        next = aimAt(d.base, d.sel, p, e.shiftKey ? 1 : 5);
        break;
      case "edge":
        next = moveRectEdge(d.base, d.room, d.edge, snap(d.edge === "n" || d.edge === "s" ? p[1] : p[0]));
        break;
      case "room":
        next = moveRoom(d.base, d.room, snap(p[0] - d.grab[0]), snap(p[1] - d.grab[1]));
        break;
    }
    // Every op returns a fresh copy: compare by value (a press that hasn't
    // moved off its 5 cm cell changes nothing).
    if (draft !== null && JSON.stringify(next) === JSON.stringify(draft)) return;
    // One undo step per drag, and none for a click that moved nothing.
    if (!dragPushed.current) {
      dragPushed.current = true;
      setUndo((u) => [...u.slice(-99), d.base]);
    }
    commit(next, false);
  };

  const endDrag = () => {
    drag.current = null;
    dragViewRef.current = null;
    setDragView(null);
  };

  // The wheel turns the selected thing (5° a notch, 1° with Shift).
  useEffect(() => {
    const el = svg.current;
    if (el === null) return;
    const on = (e: WheelEvent) => {
      if (!edit || sel === null || draft === null) return;
      const yaw = yawOf(draft, sel);
      if (yaw === null) return;
      e.preventDefault();
      commit(setYaw(draft, sel, yaw + (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 1 : 5)));
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [edit, sel, draft, commit]);

  // Keys: ⌘Z undo, Delete removes, arrows nudge (5 cm, Shift 50 cm).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !edit || draft === null) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        doUndo();
        return;
      }
      if (sel === null) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const next = removeThing(draft, sel);
        if (next !== draft) {
          commit(next);
          setSel(null);
        }
        return;
      }
      const step = e.shiftKey ? 0.5 : 0.05;
      const d: Record<string, Vec2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = d[e.key];
      if (v === undefined) return;
      e.preventDefault();
      if (sel.kind === "room") commit(moveRoom(draft, sel.id, v[0], v[1]));
      else {
        const pos = positionOf(draft, sel);
        if (pos !== null) commit(moveTo(draft, sel, snap2([pos[0] + v[0], pos[2] + v[1]])));
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [edit, draft, sel, commit, doUndo]);

  useEffect(() => {
    if (copied === null) return;
    const t = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (draft === null || loaded === null) {
    return (
      <Desktop>
        <Window title="House map" icon="🗺">
          <p className="pad">Loading the house…</p>
        </Window>
      </Desktop>
    );
  }

  const house = draft;
  const onFloor = (roomId: string) => floorOfRoom(house, roomId) === floor;
  const selected = (kind: Selection["kind"], id?: string) => sel !== null && sel.kind === kind && (id === undefined || ("id" in sel && sel.id === id));
  const selRoom = sel?.kind === "room" ? roomById(house, sel.id) : undefined;
  const addRoom = selRoom?.floor === floor ? selRoom : house.rooms.find((r) => r.floor === floor);
  const problems = textError !== null ? [textError] : (validation?.problems ?? []);
  const origin = window.location.origin;
  const copy = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => setCopied(key),
      () => setCopied(null),
    );
  };

  const add = (kind: "terminal" | "duck") => {
    if (addRoom === undefined) return;
    const r = kind === "terminal" ? addTerminal(house, addRoom.id) : addDuckSpot(house, addRoom.id);
    commit(r.house);
    setSel({ kind, id: r.id });
    setTab("inspect");
  };

  const otherFloors = house.rooms.filter((r) => r.floor !== floor);
  const floorPlayers = [...players.values()].filter((p) => p.floor === floor);

  return (
    <div className="map-page">
      <header className="map-toolbar w98-raised">
        <span className="map-title">🗺 {house.name}</span>
        <div className="w98-tabs" role="tablist">
          {house.floors.map((f) => (
            <button key={f.id} role="tab" aria-selected={f.id === floor} className={`w98-tab${f.id === floor ? " on" : ""}`} onClick={() => setFloor(f.id)}>
              {f.label}
              {[...players.values()].some((p) => p.floor === f.id) && <span className="tab-dot" />}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <label className="radio checkbox">
          <input type="checkbox" checked={edit} disabled={!editable} onChange={(e) => setEdit(e.target.checked)} /> Edit
        </label>
        {edit && (
          <>
            <button className="w98-button" disabled={addRoom === undefined} onClick={() => add("terminal")} title="in the selected room (else the floor's first)">
              + Terminal
            </button>
            <button className="w98-button" disabled={addRoom === undefined} onClick={() => add("duck")} title="in the selected room (else the floor's first)">
              + Duck spot
            </button>
            <button className="w98-button" disabled={undo.length === 0} onClick={doUndo} title="⌘Z">
              ↶ Undo
            </button>
            <button className="w98-button" disabled={!dirty && textError === null} onClick={revert}>
              Revert
            </button>
            <button className="w98-button default" disabled={!dirty || textError !== null || !validation?.ok || saveState.kind === "saving" || !editable} onClick={() => void save()}>
              {saveState.kind === "saving" ? "Saving…" : "💾 Save"}
            </button>
          </>
        )}
        <span className="map-status">
          <span className={`led${live ? " on" : ""}`} />
          {loaded.source === "bundled" ? "offline — the bundled show map" : `${loaded.source === "event" ? "this event's map" : "the show's map"} · v${loaded.version}`}
          {dirty && <b> · unsaved</b>}
        </span>
        <a className="w98-button" href="./">
          ✕
        </a>
      </header>

      {!editable && (
        <div className="map-banner w98-raised">
          Couldn't reach the server — showing the bundled show map (read-only).
          <button className="w98-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {remoteChanged && (
        <div className="map-banner w98-raised">
          The map was changed elsewhere.
          <button className="w98-button" onClick={() => void load()}>
            Reload (discard my edits)
          </button>
          <button className="w98-button" onClick={() => setRemoteChanged(false)}>
            Keep editing
          </button>
        </div>
      )}

      <main className="map-main">
        <div className="map-canvas w98-sunken">
          <svg
            ref={svg}
            viewBox={viewBox.join(" ")}
            className={`plan${edit ? " editing" : ""}`}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onPointerDownCapture={() => {
              // The plan takes the keys (arrows nudge) from whatever
              // control had focus — SVG shapes never take it themselves.
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
            onPointerDown={(e) => {
              // A click on empty floor: select the room under it (and in
              // edit mode, a rectangular room's edge starts a resize).
              const p = toPlan(e);
              const room = roomUnder(house, floor, p);
              if (edit && selRoom !== undefined && selRoom.floor === floor) {
                const edge = hitRectEdge(selRoom, p, 0.18);
                if (edge !== null) return startDrag(e, { kind: "edge", room: selRoom.id, edge, base: house });
              }
              setSel(room !== null ? { kind: "room", id: room.id } : null);
              if (room !== null) setTab("inspect");
              if (edit && room !== null && selRoom?.id === room.id && rectOf(room.poly) !== null) startDrag(e, { kind: "room", room: room.id, base: house, grab: p });
            }}
          >
            <defs>
              <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--grid)" strokeWidth="0.015" />
              </pattern>
              <pattern id="hatch" width="0.2" height="0.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="0.2" stroke="#806020" strokeWidth="0.06" />
              </pattern>
              <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#5a3a00" />
              </marker>
            </defs>
            <rect x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} fill="url(#grid)" />
            <g className="compass-mark" transform={`translate(${viewBox[0] + 0.55} ${viewBox[1] + 0.6})`}>
              <path d="M 0 -0.4 L 0.16 0.12 L 0 0.02 L -0.16 0.12 z" />
              <text y="0.45">N</text>
            </g>

            {/* the other floors, as ghosts */}
            {otherFloors.map((r) => (
              <polygon key={`ghost-${r.id}`} className="ghost-room" points={pointsAttr(r.poly)} />
            ))}

            {/* rooms */}
            {house.rooms.map((r, i) =>
              r.floor !== floor ? null : (
                <polygon
                  key={r.id}
                  className={`room${r.outdoor ? " outdoor" : ""}${selected("room", r.id) ? " selected" : ""}`}
                  points={pointsAttr(r.poly)}
                  fill={r.color ?? ROOM_TINTS[i % ROOM_TINTS.length]}
                />
              ),
            )}

            {/* stairs */}
            {house.stairs.map((s) => {
              const lower = floorOfRoom(house, s.from) === floor;
              const upper = floorOfRoom(house, s.to) === floor;
              if (!lower && !upper) return null;
              const [x0, z0, x1, z1] = s.rect;
              const a = stairArrow(s);
              return (
                <g key={s.id} className={`stair${upper ? " upper" : ""}`}>
                  <rect x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="url(#hatch)" />
                  <line x1={a.from[0]} y1={a.from[1]} x2={a.to[0]} y2={a.to[1]} markerEnd="url(#arrow)" />
                  <text x={(x0 + x1) / 2} y={(z0 + z1) / 2} className="small-label">
                    {upper ? "down" : "up"}
                  </text>
                </g>
              );
            })}

            {/* props */}
            {house.props.map((p) =>
              !onFloor(p.room) ? null : (
                <g key={p.id} className={`prop ${p.kind}${selected("prop", p.id) ? " selected" : ""}`} onPointerDown={(e) => {
                  e.stopPropagation();
                  setSel({ kind: "prop", id: p.id });
                  setTab("inspect");
                  startDrag(e, { kind: "move", sel: { kind: "prop", id: p.id }, base: house, grab: toPlan(e), origin: [p.pos[0], p.pos[2]] });
                }}>
                  {p.kind === "cylinder" ? (
                    <ellipse cx={p.pos[0]} cy={p.pos[2]} rx={p.size[0] / 2} ry={p.size[2] / 2} fill={p.color ?? "#999"} />
                  ) : (
                    <polygon points={pointsAttr(propCorners(p))} fill={p.kind === "label" ? "#ffffe0" : (p.color ?? "#999")} />
                  )}
                  {(p.label !== undefined || p.kind === "label") && (
                    <text x={p.pos[0]} y={p.pos[2]} className="prop-label">
                      {p.label ?? p.id}
                    </text>
                  )}
                </g>
              ),
            )}

            {/* walls */}
            {walls.map((w, i) => {
              if (w.floor !== floor) return null;
              const [a, b] = wallEnds(w);
              return <line key={i} className={`wall ${w.kind}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
            })}

            {/* doors */}
            {house.doors.map((d) =>
              !onFloor(d.a) ? null : (
                <g key={d.id} className="door">
                  <circle cx={d.at[0]} cy={d.at[1]} r={0.09} />
                  <title>{`${d.id}: ${d.a} ↔ ${d.b ?? "outside"}`}</title>
                </g>
              ),
            )}

            {/* room labels (over walls, under markers) */}
            {house.rooms.map((r) => {
              if (r.floor !== floor) return null;
              const at = labelSpot(r.poly);
              return (
                <g key={`label-${r.id}`} className="room-label" transform={`translate(${at[0]} ${at[1]})`}>
                  <text className="room-name">{r.label}</text>
                  {r.location !== undefined && (
                    <text className="room-loc" y={0.38}>
                      {r.location}
                    </text>
                  )}
                </g>
              );
            })}

            {/* terminals + cones */}
            {house.terminals.map((t) => {
              if (!onFloor(t.room)) return null;
              const s: Selection = { kind: "terminal", id: t.id };
              const handle = along([t.pos[0], t.pos[2]], t.yaw, 0.75);
              const on = selected("terminal", t.id);
              return (
                <g key={t.id} className={`terminal${on ? " selected" : ""}`}>
                  <polygon className="cone" points={pointsAttr(viewCone(t))} />
                  <g
                    transform={`translate(${t.pos[0]} ${t.pos[2]}) rotate(${-t.yaw})`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSel(s);
                      setTab("inspect");
                      startDrag(e, { kind: "move", sel: s, base: house, grab: toPlan(e), origin: [t.pos[0], t.pos[2]] });
                    }}
                  >
                    <rect className="screen" x={-0.2} y={-0.07} width={0.4} height={0.14} />
                    <rect className="hit" x={-0.3} y={-0.3} width={0.6} height={0.6} />
                  </g>
                  <text className="marker-label" x={t.pos[0]} y={t.pos[2] + 0.42}>
                    {t.name}
                  </text>
                  {edit && on && <circle className="rot-handle" cx={handle[0]} cy={handle[1]} r={0.13} onPointerDown={(e) => startDrag(e, { kind: "aim", sel: s, base: house })} />}
                </g>
              );
            })}

            {/* duck spots */}
            {house.duck.spots.map((d) => {
              if (!onFloor(d.room)) return null;
              const s: Selection = { kind: "duck", id: d.id };
              const hunted = [...players.values()].some((p) => p.duck.id === d.id);
              return (
                <g
                  key={d.id}
                  className={`duck-spot${selected("duck", d.id) ? " selected" : ""}${hunted ? " hunted" : ""}`}
                  transform={`translate(${d.pos[0]} ${d.pos[2]})`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSel(s);
                    setTab("inspect");
                    startDrag(e, { kind: "move", sel: s, base: house, grab: toPlan(e), origin: [d.pos[0], d.pos[2]] });
                  }}
                >
                  <circle r={0.2} />
                  <path className="duck-glyph" d="M -0.1 0.02 Q -0.1 0.11 0.02 0.11 Q 0.13 0.11 0.13 0.0 L 0.05 0 Q 0.08 -0.12 0 -0.12 Q -0.08 -0.12 -0.06 -0.03 Z" />
                  <title>{d.id}</title>
                </g>
              );
            })}

            {/* spawn */}
            {onFloor(house.spawn.room) && (
              <g className={`spawn${selected("spawn") ? " selected" : ""}`}>
                <g
                  transform={`translate(${house.spawn.pos[0]} ${house.spawn.pos[2]}) rotate(${-house.spawn.yaw})`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSel({ kind: "spawn" });
                    setTab("inspect");
                    startDrag(e, { kind: "move", sel: { kind: "spawn" }, base: house, grab: toPlan(e), origin: [house.spawn.pos[0], house.spawn.pos[2]] });
                  }}
                >
                  <circle r={0.26} />
                  <path d="M 0 -0.45 L 0.14 -0.18 L -0.14 -0.18 z" />
                </g>
                <text className="marker-label" x={house.spawn.pos[0]} y={house.spawn.pos[2] + 0.5}>
                  spawn
                </text>
                {edit && selected("spawn") && (
                  <circle
                    className="rot-handle"
                    cx={along([house.spawn.pos[0], house.spawn.pos[2]], house.spawn.yaw, 0.75)[0]}
                    cy={along([house.spawn.pos[0], house.spawn.pos[2]], house.spawn.yaw, 0.75)[1]}
                    r={0.13}
                    onPointerDown={(e) => startDrag(e, { kind: "aim", sel: { kind: "spawn" }, base: house })}
                  />
                )}
              </g>
            )}

            {/* a selected rectangular room's resize edges */}
            {edit && selRoom !== undefined && selRoom.floor === floor && rectOf(selRoom.poly) !== null && (
              <g className="edge-handles">
                {(() => {
                  const [x0, z0, x1, z1] = rectOf(selRoom.poly)!;
                  return (
                    <>
                      <line x1={x0} y1={z0} x2={x1} y2={z0} />
                      <line x1={x1} y1={z0} x2={x1} y2={z1} />
                      <line x1={x0} y1={z1} x2={x1} y2={z1} />
                      <line x1={x0} y1={z0} x2={x0} y2={z1} />
                    </>
                  );
                })()}
              </g>
            )}

            {/* live players */}
            {floorPlayers.map((p) => {
              const color = playerColor(p.guest);
              const tip = along([p.p[0], p.p[2]], p.yaw, 0.45);
              return (
                <g key={p.session} className={`player${p.found ? " found" : ""}`}>
                  {floorOfRoom(house, p.duck.room) === floor && (
                    <line className="hunt" x1={p.p[0]} y1={p.p[2]} x2={p.duck.pos[0]} y2={p.duck.pos[2]} stroke={color} />
                  )}
                  <line className="facing" x1={p.p[0]} y1={p.p[2]} x2={tip[0]} y2={tip[1]} stroke={color} />
                  <circle cx={p.p[0]} cy={p.p[2]} r={0.24} fill={color} />
                  <text className="player-name" x={p.p[0]} y={p.p[2] - 0.38}>
                    {p.name} [{p.world.toUpperCase()}]
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="map-legend">
            <span className="lg wall" /> wall <span className="lg fence" /> fence <span className="lg rail" /> rail <span className="lg door" /> door <span className="lg term" /> terminal <span className="lg duck" /> duck spot
            {edit && <span className="muted"> · drag to move · wheel or the round handle to turn · arrows nudge · Delete removes · ⌘Z undo</span>}
          </div>
        </div>

        <aside className="map-side">
          <div className="w98-tabs" role="tablist">
            {(
              [
                ["inspect", "Inspector"],
                ["terminals", `Terminals (${house.terminals.length})`],
                ["players", `Players (${players.size})`],
                ["json", "JSON"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`w98-tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="map-panel w98-raised">
            {tab === "inspect" && <Inspector house={house} sel={sel} edit={edit} commit={commit} onRemoved={() => setSel(null)} origin={origin} copy={copy} copied={copied} />}
            {tab === "terminals" && (
              <div className="term-list">
                <p className="muted small">
                  Open a terminal's link on its tablet <b>after adding</b> <code>&amp;code=&lt;mod passcode&gt;</code> — links here never carry the passcode.
                </p>
                {house.terminals.map((t) => {
                  const link = provisionLink(origin, t);
                  return (
                    <div key={t.id} className={`term-row${selected("terminal", t.id) ? " on" : ""}`}>
                      <button
                        className="term-name"
                        onClick={() => {
                          setFloor(floorOfRoom(house, t.room));
                          setSel({ kind: "terminal", id: t.id });
                        }}
                      >
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
            )}
            {tab === "players" && (
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
                    <button className="w98-button small" onClick={() => setFloor(p.floor)}>
                      Show
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tab === "json" && (
              <textarea
                className="json w98-input"
                value={text}
                readOnly={!edit}
                spellCheck={false}
                onChange={(e) => {
                  setText(e.target.value);
                  setSaveState((st) => (st.kind === "ok" ? { kind: "idle" } : st));
                  const r = draftFromText(e.target.value);
                  if (!r.ok) return setTextError(r.error);
                  setTextError(null);
                  setUndo((u) => [...u.slice(-99), house]);
                  setDraft(r.house);
                }}
              />
            )}
          </div>

          <div className={`problems w98-raised${problems.length > 0 ? " bad" : ""}`}>
            {problems.length === 0 ? (
              <div className="ok">✔ The map is valid.</div>
            ) : (
              <>
                <div className="bad-head">⚠ {problems.length} problem{problems.length === 1 ? "" : "s"} — fix before saving</div>
                <ul>
                  {problems.slice(0, 30).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </>
            )}
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
                  <button className="w98-button" onClick={() => copy("draft", stringify(draft))}>
                    {copied === "draft" ? "Copied ✔" : "Copy my edits (JSON)"}
                  </button>
                  <button className="w98-button default" onClick={() => void load()}>
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
        </aside>
      </main>
    </div>
  );
}

// --- the inspector -------------------------------------------------------------

function Num({ label, value, onChange, step = 0.05, disabled }: { label: string; value: number; onChange: (v: number) => void; step?: number; disabled: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="num">
      {label}
      <input
        className="w98-input"
        type="number"
        step={step}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

function Inspector({
  house,
  sel,
  edit,
  commit,
  onRemoved,
  origin,
  copy,
  copied,
}: {
  house: HouseMap;
  sel: Selection | null;
  edit: boolean;
  commit: (h: HouseMap) => void;
  onRemoved: () => void;
  origin: string;
  copy: (key: string, value: string) => void;
  copied: string | null;
}) {
  if (sel === null) return <p className="muted">Click a room, a terminal, a duck spot or the spawn. Tick <b>Edit</b> to change the map.</p>;
  const pos = positionOf(house, sel);
  const posFields =
    pos === null ? null : (
      <div className="num-row">
        <Num label="x" value={pos[0]} disabled={!edit} onChange={(v) => commit(moveTo(house, sel, [v, pos[2]]))} />
        <Num label="y" value={pos[1]} disabled={!edit} onChange={(v) => commit(setHeight(house, sel, v))} />
        <Num label="z" value={pos[2]} disabled={!edit} onChange={(v) => commit(moveTo(house, sel, [pos[0], v]))} />
      </div>
    );
  const yaw = yawOf(house, sel);
  const yawField = yaw === null ? null : <Num label="yaw °" value={yaw} step={5} disabled={!edit} onChange={(v) => commit(setYaw(house, sel, v))} />;
  const remove =
    edit && (sel.kind === "terminal" || (sel.kind === "duck" && house.duck.spots.length > 1)) ? (
      <button
        className="w98-button"
        onClick={() => {
          commit(removeThing(house, sel));
          onRemoved();
        }}
      >
        Remove
      </button>
    ) : null;

  switch (sel.kind) {
    case "terminal": {
      const t = house.terminals.find((x) => x.id === sel.id);
      if (t === undefined) return null;
      const link = provisionLink(origin, t);
      return (
        <div className="inspect">
          <h3>🖥 Terminal</h3>
          <div className="kv">
            id <code>{t.id}</code> · in {roomById(house, t.room)?.label ?? t.room}
          </div>
          <label className="field">
            name
            <input className="w98-input" value={t.name} disabled={!edit} onChange={(e) => commit(patchTerminal(house, t.id, { name: e.target.value }))} />
          </label>
          {posFields}
          <div className="num-row">
            {yawField}
            <Num label="pitch °" value={t.pitch ?? 0} step={5} disabled={!edit} onChange={(v) => commit(patchTerminal(house, t.id, { pitch: v === 0 ? undefined : v }))} />
            <Num
              label="fov ° (vertical)"
              value={t.fov ?? DEFAULT_SPOT_FOV}
              step={5}
              disabled={!edit}
              onChange={(v) => commit(patchTerminal(house, t.id, { fov: v === DEFAULT_SPOT_FOV ? undefined : Math.max(10, Math.min(150, v)) }))}
            />
          </div>
          <div className="field">
            provisioning link <span className="muted">(add <code>&amp;code=&lt;mod passcode&gt;</code>)</span>
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
    case "duck": {
      const d = house.duck.spots.find((x) => x.id === sel.id);
      if (d === undefined) return null;
      return (
        <div className="inspect">
          <h3>🦆 Duck spot</h3>
          <div className="kv">
            id <code>{d.id}</code> · in {roomById(house, d.room)?.label ?? d.room}
          </div>
          {posFields}
          <p className="muted small">y is where Gerald's feet are (raise it to sit him on a counter — at most {DUCK_MAX_RISE} m above the floor, or players can't reach him).</p>
          {remove}
        </div>
      );
    }
    case "spawn":
      return (
        <div className="inspect">
          <h3>★ Spawn</h3>
          <div className="kv">in {roomById(house, house.spawn.room)?.label ?? house.spawn.room}</div>
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
            id <code>{p.id}</code> · {p.kind} · {p.size.join(" × ")} m{p.label !== undefined ? ` · “${p.label}”` : ""}
          </div>
          {posFields}
          {yawField}
          <p className="muted small">Size, colour and kind are edited in the JSON tab.</p>
        </div>
      );
    }
    case "room": {
      const r = roomById(house, sel.id);
      if (r === undefined) return null;
      const rect = rectOf(r.poly);
      return (
        <div className="inspect">
          <h3>⌂ Room</h3>
          <div className="kv">
            id <code>{r.id}</code> · {r.outdoor ? "outdoor" : "indoor"} · {rect !== null ? `${(rect[2] - rect[0]).toFixed(2)} × ${(rect[3] - rect[1]).toFixed(2)} m` : `${r.poly.length}-sided`}
          </div>
          <label className="field">
            label
            <input className="w98-input" value={r.label} disabled={!edit} onChange={(e) => commit(patchRoom(house, r.id, { label: e.target.value }))} />
          </label>
          <label className="field">
            story LOCATION
            <input className="w98-input" value={r.location ?? ""} disabled={!edit} onChange={(e) => commit(patchRoom(house, r.id, { location: e.target.value }))} placeholder="The Cache" />
          </label>
          <label className="field">
            floor tint
            <input className="w98-input" type="color" value={r.color ?? "#c0c0c0"} disabled={!edit} onChange={(e) => commit(patchRoom(house, r.id, { color: e.target.value }))} />
          </label>
          <p className="muted small">
            {rect !== null
              ? edit
                ? "Drag the room to move it (with what stands in it); drag an edge to resize. Doors stay put — the problem list says which to re-place."
                : "Tick Edit to move or resize it."
              : "Only rectangular rooms are resized here; edit this one's polygon in the JSON tab."}
          </p>
        </div>
      );
    }
  }
}
