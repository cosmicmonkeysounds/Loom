//! The map page's plan (SVG, one floor at a time): rooms, walls, doors,
//! stairs, props, terminals with their view cones, the duck spots, the
//! spawn and every live player — plus the editing gestures. In **Select**
//! a click selects and a drag moves (a selected room by its body, a
//! rectangular one's edge to resize, a door along its wall); the drawing
//! tools drag out a room / yard / stair rectangle or drop a door on the
//! wall clicked. Everything snaps to the snap step and room edges to their
//! neighbours' (hold ⌥ while dragging a thing to place it freely). A
//! selected prop / terminal / the spawn has a round handle out front: drag
//! it to turn (15° steps, ⇧ 1°). A terminal dropped near a wall hangs on
//! it. With a palette prop armed, the next click places it. The wheel
//! zooms (⌥ + wheel turns the selected thing); drag empty ground, hold
//! Space, or use the middle button to pan. The house speakers (`audio.json`,
//! wave 17) stand on their room's floor: a cabinet facing its yaw, its
//! output channels in a badge, a coverage ring; the 🔊 palette places one,
//! and a speaker drags and turns like a terminal (edits go to `onEditAudio`).

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { buildWalls, polyArea, polyBounds, roomById, wallEnds } from "@loom/house";
import type { AudioConfig, HouseMap, PlayerState, Vec2, WallSegment } from "@loom/house";
import { aimSpeaker, coverageRadius, moveSpeaker, rotateSpeaker, speakerFloor } from "./audio.ts";
import { doorGap, moveDoorAlong, placeDoor } from "./doors.ts";
import { aimAt, MIN_ROOM, moveRectEdge, moveRoom, moveTo, setYaw, yawOf, type Selection } from "./edit.ts";
import {
  along,
  clientToPlan,
  edgeCoords,
  edgePull,
  floorOfRoom,
  hitRectEdge,
  labelSpot,
  metres,
  panView,
  planBounds,
  playerColor,
  pointsAttr,
  propCorners,
  rectOf,
  ROOM_TINTS,
  roomUnder,
  snap,
  snap2,
  snapToNearest,
  stairArrow,
  viewBoxOf,
  viewCone,
  zoomView,
  type Bounds,
  type Edge,
} from "./plan.ts";
import { snapTerminalToWall, WALL_SNAP, YAW_STEP } from "./props.ts";
import { addRoom, addStair, moveStair, rectFrom } from "./structure.ts";
import type { EditMode, Placing, Tool } from "./tools.ts";
import { yardOf, yardsOn } from "./yards.ts";

type ViewBox = [number, number, number, number];

type Drag =
  | { kind: "move"; sel: Selection; base: HouseMap; grab: Vec2; origin: Vec2 }
  | { kind: "aim"; sel: Selection; base: HouseMap }
  | { kind: "edge"; room: string; edge: Edge; base: HouseMap }
  | { kind: "room"; room: string; base: HouseMap; grab: Vec2; rect: Bounds }
  | { kind: "door"; id: string; base: HouseMap }
  | { kind: "stair"; id: string; base: HouseMap; grab: Vec2 }
  | { kind: "draw"; tool: "room" | "yard" | "stair"; from: Vec2 }
  | { kind: "pan"; vb: ViewBox; client: Vec2 }
  | { kind: "spk-move"; id: string; base: AudioConfig; grab: Vec2; origin: Vec2 }
  | { kind: "spk-aim"; id: string; base: AudioConfig };

/** How close (screen px) a room edge pulls a dragged edge onto it. */
const EDGE_PULL_PX = 9;
/** How close (screen px) a click must be to a wall for the Door tool. */
const DOOR_PICK_PX = 18;

export interface CanvasProps {
  house: HouseMap;
  floor: string;
  edit: boolean;
  tool: Tool;
  snapStep: number;
  sel: Selection | null;
  players: ReadonlyMap<string, PlayerState>;
  onSelect: (sel: Selection | null) => void;
  onEdit: (next: HouseMap, mode: EditMode) => void;
  onNotice: (text: string) => void;
  /** A palette prop (or a speaker) waiting for its click (null: none). */
  placing?: Placing | null;
  /** Place the armed prop / speaker at a plan point (already snapped). */
  onPlace?: (at: Vec2) => void;
  /** The house speakers (null: none to draw). */
  audio?: AudioConfig | null;
  /** A speaker edit (a drag frame, a turn). */
  onEditAudio?: (next: AudioConfig, mode: EditMode) => void;
  /** Speakers to light up (a zone or a cue picked in the Audio tab). */
  highlight?: ReadonlySet<string>;
}

export function Canvas({ house, floor, edit, tool, snapStep, sel, players, onSelect, onEdit, onNotice, placing = null, onPlace, audio = null, onEditAudio, highlight }: CanvasProps) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  /** The running drag has pushed its starting map on the undo stack. */
  const dragPushed = useRef(false);
  /** The user's zoom / pan; null = fit the house. */
  const [view, setView] = useState<ViewBox | null>(null);
  /** The frame a drag started in (the ref: the first move may land before
   *  it renders) — a room dragged past the house's edge would otherwise
   *  re-fit the plan under the cursor at every move. */
  const [dragView, setDragView] = useState<ViewBox | null>(null);
  const dragViewRef = useRef<ViewBox | null>(null);
  const [preview, setPreview] = useState<{ tool: "room" | "yard" | "stair"; rect: Bounds } | null>(null);
  const space = useRef(false);

  const walls = useMemo<WallSegment[]>(() => {
    try {
      return buildWalls(house);
    } catch {
      return [];
    }
  }, [house]);
  const fit = useMemo<ViewBox>(() => viewBoxOf(planBounds(house), 1), [house]);
  /** A yard cut into pieces is one place: labelled once (on its biggest piece), selected whole. */
  const unlabelled = useMemo(() => {
    const out = new Set<string>();
    for (const f of house.floors) {
      for (const yard of yardsOn(house, f.id)) {
        if (yard.length < 2) continue;
        const size = (id: string) => Math.abs(polyArea(roomById(house, id)!.poly));
        const biggest = [...yard].sort((a, b) => size(b) - size(a))[0];
        for (const id of yard) if (id !== biggest) out.add(id);
      }
    }
    return out;
  }, [house]);
  const viewBox: ViewBox = dragView ?? view ?? fit;
  const viewRef = useRef(viewBox);
  viewRef.current = viewBox;

  // Space held = pan with the left button.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /** Screen px → plan metres at the current zoom. */
  const pxToPlan = (px: number): number => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return px * 0.02;
    return px / Math.min(r.width / viewBox[2], r.height / viewBox[3]);
  };

  const toPlan = (e: { clientX: number; clientY: number }, vb: ViewBox = dragViewRef.current ?? viewBox): Vec2 => {
    const r = svg.current?.getBoundingClientRect();
    return r ? clientToPlan(e.clientX, e.clientY, r, vb) : [0, 0];
  };

  // The wheel zooms about the cursor; ⌥ + wheel turns the selected thing (5° a notch, 1° with ⇧).
  useEffect(() => {
    const el = svg.current;
    if (el === null) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      if (e.altKey && edit && sel?.kind === "speaker" && audio !== null) {
        onEditAudio?.(rotateSpeaker(audio, sel.id, (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 1 : 5)), "push");
        return;
      }
      if (e.altKey && edit && sel !== null) {
        const yaw = yawOf(house, sel);
        if (yaw !== null) onEdit(setYaw(house, sel, yaw + (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 1 : 5)), "push");
        return;
      }
      const vb = viewRef.current;
      const r = el.getBoundingClientRect();
      const at = clientToPlan(e.clientX, e.clientY, r, vb);
      const step = Math.max(-1, Math.min(1, e.deltaY / (e.deltaMode === 1 ? 3 : 100)));
      setView(zoomView(vb, at, Math.pow(1.25, step)));
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [edit, sel, house, onEdit, audio, onEditAudio]);

  const startDrag = (e: ReactPointerEvent, d: Drag) => {
    if (d.kind !== "pan" && !edit) return;
    e.stopPropagation();
    e.preventDefault();
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = d;
    dragPushed.current = false;
    dragViewRef.current = viewBox;
    setDragView(viewBox);
  };

  /** A drag frame: the first change pushes one undo step; a press that
   *  hasn't moved off its snap cell changes nothing. */
  const frame = (next: HouseMap) => {
    if (JSON.stringify(next) === JSON.stringify(house)) return;
    onEdit(next, dragPushed.current ? "replace" : "push");
    dragPushed.current = true;
  };
  /** A speaker drag's frame, the same way. */
  const frameAudio = (next: AudioConfig) => {
    if (audio === null || onEditAudio === undefined || JSON.stringify(next) === JSON.stringify(audio)) return;
    onEditAudio(next, dragPushed.current ? "replace" : "push");
    dragPushed.current = true;
  };

  const pull = () => pxToPlan(EDGE_PULL_PX);
  const coords = (except: string | null) => edgeCoords(house, floor, except);
  /** A drawing corner: snapped, then pulled onto a room edge. */
  const corner = (p: Vec2): Vec2 => {
    const c = coords(null);
    const s = snap2(p, snapStep);
    return [snapToNearest(s[0], c.xs, pull()), snapToNearest(s[1], c.zs, pull())];
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d === null) return;
    if (d.kind === "pan") {
      // Pan in the frame the drag started in.
      const a = clientToPlan(d.client[0], d.client[1], svg.current!.getBoundingClientRect(), d.vb);
      const b = toPlan(e, d.vb);
      setView(panView(d.vb, a[0] - b[0], a[1] - b[1]));
      return;
    }
    const p = toPlan(e);
    switch (d.kind) {
      case "move": {
        // ⌥: no grid (to the millimetre).
        const moved = moveTo(d.base, d.sel, snap2([d.origin[0] + p[0] - d.grab[0], d.origin[1] + p[1] - d.grab[1]], e.altKey ? 0.001 : snapStep));
        // A terminal let near a wall hangs on it.
        return frame(d.sel.kind === "terminal" && !e.altKey ? snapTerminalToWall(moved, d.sel.id, WALL_SNAP) : moved);
      }
      case "aim":
        return frame(aimAt(d.base, d.sel, p, e.shiftKey ? 1 : YAW_STEP));
      case "edge": {
        const c = edgeCoords(d.base, floor, d.room);
        const v = snap(d.edge === "n" || d.edge === "s" ? p[1] : p[0], snapStep);
        return frame(moveRectEdge(d.base, d.room, d.edge, snapToNearest(v, d.edge === "n" || d.edge === "s" ? c.zs : c.xs, pull())));
      }
      case "room": {
        let dx = snap(p[0] - d.grab[0], snapStep);
        let dz = snap(p[1] - d.grab[1], snapStep);
        const r = d.rect;
        const [px, pz] = edgePull([r[0] + dx, r[1] + dz, r[2] + dx, r[3] + dz], edgeCoords(d.base, floor, d.room), pull());
        dx = Number((dx + px).toFixed(4));
        dz = Number((dz + pz).toFixed(4));
        return frame(moveRoom(d.base, d.room, dx, dz));
      }
      case "door":
        return frame(moveDoorAlong(d.base, d.id, p, snapStep));
      case "stair":
        return frame(moveStair(d.base, d.id, snap(p[0] - d.grab[0], snapStep), snap(p[1] - d.grab[1], snapStep)));
      case "draw":
        setPreview({ tool: d.tool, rect: rectFrom(d.from, corner(p)) });
        return;
      case "spk-move":
        return frameAudio(moveSpeaker(d.base, house, d.id, snap2([d.origin[0] + p[0] - d.grab[0], d.origin[1] + p[1] - d.grab[1]], e.altKey ? 0.001 : snapStep)));
      case "spk-aim":
        return frameAudio(aimSpeaker(d.base, d.id, p, e.shiftKey ? 1 : YAW_STEP));
    }
  };

  const endDrag = (e?: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    dragViewRef.current = null;
    setDragView(null);
    if (d?.kind !== "draw") return;
    setPreview(null);
    if (e === undefined) return;
    const rect = rectFrom(d.from, corner(toPlan(e)));
    if (rect[2] - rect[0] < MIN_ROOM || rect[3] - rect[1] < MIN_ROOM) {
      onNotice(`Drag out a rectangle at least ${MIN_ROOM * 100} cm on each side.`);
      return;
    }
    if (d.tool === "stair") {
      const r = addStair(house, floor, rect);
      onEdit(r.house, "push");
      onSelect({ kind: "stair", id: r.id });
      return;
    }
    const r = addRoom(house, floor, rect, { outdoor: d.tool === "yard" });
    onEdit(r.house, "push");
    onSelect({ kind: "room", id: r.id });
  };

  const selRoom = sel?.kind === "room" ? roomById(house, sel.id) : undefined;
  const selYard = new Set(selRoom?.outdoor ? yardOf(house, selRoom.id) : []);
  const selected = (kind: Selection["kind"], id?: string) => sel !== null && sel.kind === kind && (id === undefined || ("id" in sel && sel.id === id));
  const onFloor = (roomId: string) => floorOfRoom(house, roomId) === floor;
  /** Markers take clicks in Select only (a drawing tool, or an armed palette prop, draws through them). */
  const picking = tool === "select" && placing === null;
  const pick = (e: ReactPointerEvent, s: Selection, d?: Drag) => {
    if (!picking || e.button !== 0 || space.current) return;
    e.stopPropagation();
    onSelect(s);
    if (d !== undefined) startDrag(e, d);
  };

  const onBackgroundDown = (e: ReactPointerEvent) => {
    const p = toPlan(e, viewBox);
    if (e.button === 1 || (e.button === 0 && space.current)) return startDrag(e, { kind: "pan", vb: viewBox, client: [e.clientX, e.clientY] });
    if (e.button !== 0) return;
    if (edit && placing !== null && onPlace !== undefined) {
      onPlace(e.altKey ? snap2(p, 0.001) : snap2(p, snapStep));
      return;
    }
    if (edit && tool === "door") {
      const r = placeDoor(house, floor, p, { tol: Math.max(0.15, pxToPlan(DOOR_PICK_PX)), step: snapStep });
      if (r === null) return onNotice("No wall there — click on (or right by) a room's edge.");
      onEdit(r.house, "push");
      onSelect({ kind: "door", id: r.id });
      return;
    }
    if (edit && (tool === "room" || tool === "yard" || tool === "stair")) {
      const from = corner(p);
      startDrag(e, { kind: "draw", tool, from });
      setPreview({ tool, rect: [from[0], from[1], from[0], from[1]] });
      return;
    }
    // Select: a selected rectangular room's edge resizes it; a click picks
    // the room under it. A yard cut into pieces is never dragged piece by
    // piece (move the room standing in it, or Fill the yard).
    const whole = selYard.size < 2;
    if (edit && whole && selRoom !== undefined && selRoom.floor === floor) {
      const edge = hitRectEdge(selRoom, p, pxToPlan(8));
      if (edge !== null) return startDrag(e, { kind: "edge", room: selRoom.id, edge, base: house });
    }
    const room = roomUnder(house, floor, p);
    onSelect(room !== null ? { kind: "room", id: room.id } : null);
    if (room === null) return startDrag(e, { kind: "pan", vb: viewBox, client: [e.clientX, e.clientY] });
    if (edit && whole && selRoom?.id === room.id) {
      const [x0, z0, x1, z1] = rectOf(room.poly) ?? polyBounds(room.poly);
      startDrag(e, { kind: "room", room: room.id, base: house, grab: p, rect: [x0, z0, x1, z1] });
    }
  };

  const otherFloors = house.rooms.filter((r) => r.floor !== floor);
  const floorPlayers = [...players.values()].filter((p) => p.floor === floor);
  const selRect = selRoom !== undefined && selRoom.floor === floor ? rectOf(selRoom.poly) : null;
  const zoomBy = (f: number) => setView(zoomView(viewBox, [viewBox[0] + viewBox[2] / 2, viewBox[1] + viewBox[3] / 2], f));

  return (
    <div className="map-canvas w98-sunken">
      <svg
        ref={svg}
        viewBox={viewBox.join(" ")}
        className={`plan${edit ? " editing" : ""} tool-${placing !== null && edit ? "place" : tool}`}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={() => endDrag()}
        onLostPointerCapture={() => drag.current !== null && drag.current.kind !== "draw" && endDrag()}
        onPointerDownCapture={() => {
          // The plan takes the keys (arrows nudge) from whatever control
          // had focus — SVG shapes never take it themselves.
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }}
        onPointerDown={onBackgroundDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--grid)" strokeWidth="0.015" />
          </pattern>
          <pattern id="grid-fine" width="0.25" height="0.25" patternUnits="userSpaceOnUse">
            <path d="M 0.25 0 L 0 0 0 0.25" fill="none" stroke="var(--grid)" strokeWidth="0.005" />
          </pattern>
          <pattern id="hatch" width="0.2" height="0.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="0.2" stroke="#806020" strokeWidth="0.06" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#5a3a00" />
          </marker>
        </defs>
        {viewBox[2] < 14 && <rect x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} fill="url(#grid-fine)" />}
        <rect x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} fill="url(#grid)" />
        <g className="origin-mark">
          <line x1={-0.3} y1={0} x2={0.3} y2={0} />
          <line x1={0} y1={-0.3} x2={0} y2={0.3} />
        </g>
        <g className="compass-mark" transform={`translate(${viewBox[0] + viewBox[2] * 0.04} ${viewBox[1] + viewBox[2] * 0.045}) scale(${viewBox[2] / 14})`}>
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
            <polygon key={r.id} className={`room${r.outdoor ? " outdoor" : ""}${selected("room", r.id) ? " selected" : selYard.has(r.id) ? " selected yard-piece" : ""}`} points={pointsAttr(r.poly)} fill={r.color ?? (r.outdoor ? "#b8d8a8" : ROOM_TINTS[i % ROOM_TINTS.length])} />
          ),
        )}

        {/* speaker coverage (under everything placed) */}
        {audio?.speakers.map((s) => {
          if (speakerFloor(house, s) !== floor) return null;
          const on = selected("speaker", s.id);
          const lit = highlight?.has(s.id) === true;
          return <circle key={`cov-${s.id}`} className={`speaker-ring${on ? " selected" : ""}${lit ? " lit" : ""}`} cx={s.pos.x} cy={s.pos.z} r={coverageRadius(s.gain)} />;
        })}

        {/* stairs */}
        {house.stairs.map((s) => {
          const lower = floorOfRoom(house, s.from) === floor;
          const upper = floorOfRoom(house, s.to) === floor;
          if (!lower && !upper) return null;
          const [x0, z0, x1, z1] = s.rect;
          const a = stairArrow(s);
          return (
            <g
              key={s.id}
              className={`stair${upper ? " upper" : ""}${selected("stair", s.id) ? " selected" : ""}`}
              onPointerDown={(e) => pick(e, { kind: "stair", id: s.id }, { kind: "stair", id: s.id, base: house, grab: toPlan(e) })}
            >
              <rect x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="url(#hatch)" />
              <line x1={a.from[0]} y1={a.from[1]} x2={a.to[0]} y2={a.to[1]} markerEnd="url(#arrow)" />
              <text x={(x0 + x1) / 2} y={(z0 + z1) / 2} className="small-label">
                {upper ? "down" : "up"}
              </text>
            </g>
          );
        })}

        {/* props */}
        {house.props.map((p) => {
          if (!onFloor(p.room)) return null;
          const on = selected("prop", p.id);
          const ps: Selection = { kind: "prop", id: p.id };
          const yaw = p.yaw ?? 0;
          const front = along([p.pos[0], p.pos[2]], yaw, p.size[2] / 2);
          const knob = along([p.pos[0], p.pos[2]], yaw, p.size[2] / 2 + 0.35);
          return (
            <g
              key={p.id}
              className={`prop ${p.kind}${on ? " selected" : ""}`}
              onPointerDown={(e) => pick(e, ps, { kind: "move", sel: ps, base: house, grab: toPlan(e), origin: [p.pos[0], p.pos[2]] })}
            >
              {p.kind === "cylinder" ? (
                <ellipse cx={p.pos[0]} cy={p.pos[2]} rx={p.size[0] / 2} ry={p.size[2] / 2} transform={`rotate(${-yaw} ${p.pos[0]} ${p.pos[2]})`} fill={p.color ?? "#999"} />
              ) : (
                <polygon points={pointsAttr(propCorners(p))} fill={p.kind === "label" ? "#ffffe0" : (p.color ?? "#999")} />
              )}
              {p.kind === "king" && (
                <text x={p.pos[0]} y={p.pos[2]} className="king-glyph">
                  ♔
                </text>
              )}
              {(p.label !== undefined || p.kind === "label") && (
                <text x={p.pos[0]} y={p.pos[2] + (p.kind === "king" ? 0.45 : 0)} className="prop-label">
                  {p.label ?? p.id}
                </text>
              )}
              {on && <line className="prop-front" x1={p.pos[0]} y1={p.pos[2]} x2={front[0]} y2={front[1]} />}
              {edit && on && (
                <>
                  <line className="rot-arm" x1={front[0]} y1={front[1]} x2={knob[0]} y2={knob[1]} />
                  <circle className="rot-handle" cx={knob[0]} cy={knob[1]} r={0.13} onPointerDown={(e) => startDrag(e, { kind: "aim", sel: ps, base: house })}>
                    <title>{`Drag to turn (${YAW_STEP}° steps, ⇧ 1°) · R / ⇧R · ${yaw}°`}</title>
                  </circle>
                </>
              )}
            </g>
          );
        })}

        {/* walls */}
        {walls.map((w, i) => {
          if (w.floor !== floor) return null;
          const [a, b] = wallEnds(w);
          return <line key={i} className={`wall ${w.kind}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}

        {/* doors: the gap, and a handle */}
        {house.doors.map((d) => {
          if (!onFloor(d.a)) return null;
          const gap = doorGap(house, d);
          const on = selected("door", d.id);
          return (
            <g key={d.id} className={`door${on ? " selected" : ""}${gap === null ? " stray" : ""}${d.b !== null && roomById(house, d.a)?.outdoor && roomById(house, d.b)?.outdoor ? " opening" : ""}`}>
              {gap !== null && <line className="gap" x1={gap[0][0]} y1={gap[0][1]} x2={gap[1][0]} y2={gap[1][1]} />}
              <circle cx={d.at[0]} cy={d.at[1]} r={0.09} onPointerDown={(e) => pick(e, { kind: "door", id: d.id }, { kind: "door", id: d.id, base: house })} />
              <title>{`${d.id}: ${roomById(house, d.a)?.label ?? d.a} ↔ ${d.b === null ? "outside" : (roomById(house, d.b)?.label ?? d.b)} · ${metres(d.width)}`}</title>
            </g>
          );
        })}

        {/* room labels (over walls, under markers) */}
        {house.rooms.map((r) => {
          if (r.floor !== floor || unlabelled.has(r.id)) return null;
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
              <polygon className="cone" points={pointsAttr(viewCone(t, on ? 4 : 2.5))} />
              {on && <line className="cone-axis" x1={t.pos[0]} y1={t.pos[2]} x2={along([t.pos[0], t.pos[2]], t.yaw, 4)[0]} y2={along([t.pos[0], t.pos[2]], t.yaw, 4)[1]} />}
              <g transform={`translate(${t.pos[0]} ${t.pos[2]}) rotate(${-t.yaw})`} onPointerDown={(e) => pick(e, s, { kind: "move", sel: s, base: house, grab: toPlan(e), origin: [t.pos[0], t.pos[2]] })}>
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

        {/* speakers: drawn bigger as the plan zooms out, so the badge stays readable */}
        {audio !== null &&
          audio.speakers.map((s) => {
            if (speakerFloor(house, s) !== floor) return null;
            const ss: Selection = { kind: "speaker", id: s.id };
            const on = selected("speaker", s.id);
            const lit = highlight?.has(s.id) === true;
            const k = Math.max(1, Math.min(2.6, viewBox[2] / 12));
            const knob = along([s.pos.x, s.pos.z], s.yaw, 0.6 * k);
            const badge = s.out.length === 0 ? "—" : s.out.join(" ");
            const bw = 0.12 + 0.085 * badge.length;
            return (
              <g key={s.id} className={`speaker${on ? " selected" : ""}${lit ? " lit" : ""}${s.out.length === 0 ? " silent" : ""}`}>
                <g transform={`translate(${s.pos.x} ${s.pos.z}) scale(${k})`}>
                  <g transform={`rotate(${-s.yaw})`} onPointerDown={(e) => pick(e, ss, { kind: "spk-move", id: s.id, base: audio, grab: toPlan(e), origin: [s.pos.x, s.pos.z] })}>
                    <path className="waves" d="M -0.13 -0.24 Q 0 -0.31 0.13 -0.24 M -0.19 -0.31 Q 0 -0.41 0.19 -0.31" />
                    <path className="horn" d="M -0.08 -0.03 L -0.17 -0.16 L 0.17 -0.16 L 0.08 -0.03 Z" />
                    <rect className="cab" x={-0.12} y={-0.04} width={0.24} height={0.15} rx={0.02} />
                    <rect className="hit" x={-0.28} y={-0.42} width={0.56} height={0.56} />
                  </g>
                  <g className="out-badge" transform="translate(0 0.28)">
                    <rect x={-bw / 2} y={-0.08} width={bw} height={0.16} rx={0.03} />
                    <text>{badge}</text>
                  </g>
                  <text className="speaker-name" y={0.5}>
                    {s.name}
                  </text>
                </g>
                {edit && on && (
                  <>
                    <line className="rot-arm" x1={s.pos.x} y1={s.pos.z} x2={knob[0]} y2={knob[1]} />
                    <circle className="rot-handle" cx={knob[0]} cy={knob[1]} r={0.13 * k} onPointerDown={(e) => startDrag(e, { kind: "spk-aim", id: s.id, base: audio })}>
                      <title>{`Drag to turn (${YAW_STEP}° steps, ⇧ 1°) · R / ⇧R · ${s.yaw}°`}</title>
                    </circle>
                  </>
                )}
                <title>{`${s.name} (${s.id}) · out ${s.out.length === 0 ? "none" : s.out.join(", ")}${s.gain !== undefined ? ` · ${s.gain > 0 ? "+" : ""}${s.gain} dB` : ""}`}</title>
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
              onPointerDown={(e) => pick(e, s, { kind: "move", sel: s, base: house, grab: toPlan(e), origin: [d.pos[0], d.pos[2]] })}
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
              onPointerDown={(e) => pick(e, { kind: "spawn" }, { kind: "move", sel: { kind: "spawn" }, base: house, grab: toPlan(e), origin: [house.spawn.pos[0], house.spawn.pos[2]] })}
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

        {/* a selected rectangular room: its resize edges and its size */}
        {selRect !== null && (
          <g className="edge-handles">
            {edit && selYard.size < 2 && (
              <>
                <line x1={selRect[0]} y1={selRect[1]} x2={selRect[2]} y2={selRect[1]} />
                <line x1={selRect[2]} y1={selRect[1]} x2={selRect[2]} y2={selRect[3]} />
                <line x1={selRect[0]} y1={selRect[3]} x2={selRect[2]} y2={selRect[3]} />
                <line x1={selRect[0]} y1={selRect[1]} x2={selRect[0]} y2={selRect[3]} />
              </>
            )}
            <Dimensions rect={selRect} scale={viewBox[2] / 14} />
          </g>
        )}

        {/* the rectangle being drawn */}
        {preview !== null && (
          <g className={`draw-preview ${preview.tool}`}>
            <rect x={preview.rect[0]} y={preview.rect[1]} width={preview.rect[2] - preview.rect[0]} height={preview.rect[3] - preview.rect[1]} />
            <Dimensions rect={preview.rect} scale={viewBox[2] / 14} />
          </g>
        )}

        {/* live players */}
        {floorPlayers.map((p) => {
          const color = playerColor(p.guest);
          const tip = along([p.p[0], p.p[2]], p.yaw, 0.45);
          return (
            <g key={p.session} className={`player${p.found ? " found" : ""}`}>
              {floorOfRoom(house, p.duck.room) === floor && <line className="hunt" x1={p.p[0]} y1={p.p[2]} x2={p.duck.pos[0]} y2={p.duck.pos[2]} stroke={color} />}
              <line className="facing" x1={p.p[0]} y1={p.p[2]} x2={tip[0]} y2={tip[1]} stroke={color} />
              <circle cx={p.p[0]} cy={p.p[2]} r={0.24} fill={color} />
              <text className="player-name" x={p.p[0]} y={p.p[2] - 0.38}>
                {p.name} [{p.world.toUpperCase()}]
              </text>
            </g>
          );
        })}
      </svg>
      <div className="map-zoom">
        <button className="w98-button small" onClick={() => zoomBy(0.8)} title="Zoom in (wheel)">
          ＋
        </button>
        <button className="w98-button small" onClick={() => zoomBy(1.25)} title="Zoom out (wheel)">
          －
        </button>
        <button className="w98-button small" onClick={() => setView(null)} title="Fit the whole house">
          Fit
        </button>
      </div>
      <div className="map-legend">
        <span className="lg wall" /> wall <span className="lg fence" /> fence <span className="lg rail" /> rail <span className="lg door" /> door <span className="lg term" /> terminal <span className="lg duck" /> duck spot{audio !== null && audio.speakers.length > 0 && <><span className="lg spk" /> speaker (outputs)</>}
        <span className="muted">
          {" "}
          · wheel zooms · drag empty ground (or Space-drag) pans
          {edit &&
            (placing !== null
              ? ` · click inside a room to place the ${placing === "speaker" ? "speaker" : placing} · Esc cancels`
              : tool === "select"
                ? " · drag to move (⌥ no snap) · the round handle, R / ⇧R or ⌥-wheel turns · arrows nudge · ⌘D duplicates · Delete removes · ⌘Z / ⇧⌘Z"
                : " · Esc back to Select")}
        </span>
      </div>
    </div>
  );
}

/** A rect's W × D, along its north and east edges. */
function Dimensions({ rect, scale }: { rect: Bounds; scale: number }) {
  const [x0, z0, x1, z1] = rect;
  const s = Math.max(0.6, Math.min(2.5, scale));
  return (
    <g className="dims" style={{ fontSize: `${0.26 * s}px` }}>
      <text x={(x0 + x1) / 2} y={z0 - 0.12 * s}>
        {metres(x1 - x0)}
      </text>
      <text x={x1 + 0.12 * s} y={(z0 + z1) / 2} transform={`rotate(90 ${x1 + 0.12 * s} ${(z0 + z1) / 2})`}>
        {metres(z1 - z0)}
      </text>
    </g>
  );
}
