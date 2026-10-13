//! The corner mini-map: one floor's plan, every player on it as a dot with a
//! heading tick (the followed one ringed), each player's duck in gold, and
//! this terminal's view cone. North is up (see `minimap.ts`).

import { useMemo } from "react";
import type { HouseMap, TerminalSpot } from "@loom/house";
import { conePath, ducksOn, floorView, planDir } from "./minimap.ts";
import type { WorldPlayer } from "./state.ts";

export function MiniMap({ house, floor, players, spot, subject }: { house: HouseMap; floor: string; players: readonly WorldPlayer[]; spot: TerminalSpot | null; subject: string | null }) {
  const view = useMemo(() => floorView(house, floor), [house, floor]);
  const spotHere = spot !== null && house.rooms.find((r) => r.id === spot.room)?.floor === view.floor;
  const here = players.filter((p) => p.floor === view.floor);
  return (
    <figure className="minimap" aria-label={`map of the ${view.label}`}>
      <svg viewBox={view.viewBox} preserveAspectRatio="xMidYMid meet">
        {view.rooms.map((r) => (
          <path key={r.id} d={r.d} className={`mm-room${r.outdoor ? " outdoor" : ""}${spot?.room === r.id ? " mine" : ""}`} />
        ))}
        {view.stairs.map((s) => (
          <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} className="mm-stair" />
        ))}
        {spotHere && spot !== null && (
          <>
            <path d={conePath(spot)} className="mm-cone" />
            <circle cx={spot.pos[0]} cy={spot.pos[2]} r={0.22} className="mm-terminal" />
          </>
        )}
        {ducksOn(house, view.floor, players).map((p) => (
          <circle key={`duck:${p.session}`} cx={p.duck.pos[0]} cy={p.duck.pos[2]} r={0.2} className="mm-duck" />
        ))}
        {here.map((p) => {
          const [dx, dy] = planDir(p.pose.yaw);
          const [x, y] = [p.pose.p[0], p.pose.p[2]];
          return (
            <g key={p.session} className={`mm-player${p.session === subject ? " subject" : ""}`}>
              {p.session === subject && <circle cx={x} cy={y} r={0.55} className="mm-ring" />}
              <line x1={x} y1={y} x2={x + dx * 0.6} y2={y + dy * 0.6} />
              <circle cx={x} cy={y} r={0.28} />
            </g>
          );
        })}
      </svg>
      <figcaption>{view.label.toUpperCase()}</figcaption>
    </figure>
  );
}
