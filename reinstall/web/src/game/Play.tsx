//! The play screen: the canvas the `Game` renders into, the HUD over it
//! (where you are, warmer / colder, the clock, a compass whose gold pip
//! points along the trail), the twin sticks on a touch screen, and the
//! celebration when Gerald is found.

import { useEffect, useRef, useState } from "react";
import type { Assignment, FoundResult, HouseMap } from "@loom/house";
import { postEnd } from "../api.ts";
import { baseOf, type ReinstallConfig } from "../config.ts";
import { ProgressBar, Window } from "../wizard.tsx";
import type { Sfx } from "./audio.ts";
import { Game, type GameEnd, type HudState } from "./engine.ts";
import { bearingOf, HEAT_LABEL } from "./hud.ts";
import { CENTRED, type StickVector } from "./input.ts";
import { whyNoStart } from "./no-start.ts";
import { Joystick } from "./joystick.tsx";

export type PlayExit = { kind: "found"; name: string; complete: boolean } | { kind: "over"; reason: string } | { kind: "idle" } | { kind: "quit" };

export { NO_WEBGL2 } from "./no-start.ts";

/** Seconds the celebration stays before returning to the scanner by itself. */
const CELEBRATE_S = 15;

function touchDevice(): boolean {
  return (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
}

export function Play({
  config,
  assignment,
  house,
  houseVersion,
  sfx,
  onExit,
}: {
  config: ReinstallConfig;
  assignment: Assignment;
  house: HouseMap;
  /** The version of `house` (the stream's `hello` / `house` frames are compared with it). */
  houseVersion: string;
  sfx: Sfx;
  onExit: (e: PlayExit) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const sticks = useRef<{ left: StickVector; right: StickVector }>({ left: CENTRED, right: CENTRED });
  const [hud, setHud] = useState<HudState | null>(null);
  const [found, setFound] = useState<FoundResult | null>(null);
  const [showSticks, setShowSticks] = useState(touchDevice);
  const [helpOpen, setHelpOpen] = useState(true);
  const exit = useRef(onExit);
  exit.current = onExit;
  const base = baseOf(config);

  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    let g: Game;
    try {
      g = new Game({
        canvas: el,
        house,
        houseVersion,
        assignment,
        base,
        device: config.name,
        arrowsTurn: config.arrowsTurn,
        sticks: () => sticks.current,
        sfx,
        onHud: setHud,
        onFound: setFound,
        onEnd: (e: GameEnd) => exit.current(e.kind === "idle" ? { kind: "idle" } : e),
      });
    } catch (e) {
      // No WebGL the probe missed (a context that exists but won't start:
      // NO_WEBGL2), or the dealt map / spawn tripping the build (said as is).
      void postEnd(base, assignment.token);
      console.warn("reinstall: the game didn't start", e);
      exit.current({ kind: "over", reason: whyNoStart(e) });
      return;
    }
    game.current = g;
    g.start();
    return () => {
      g.dispose();
      game.current = null;
    };
  }, [house, houseVersion, assignment, base, config.name, config.arrowsTurn, sfx]);

  // A touch anywhere shows the sticks (a laptop with a touch screen).
  useEffect(() => {
    const on = (e: PointerEvent) => {
      if (e.pointerType === "touch") setShowSticks(true);
    };
    window.addEventListener("pointerdown", on);
    return () => window.removeEventListener("pointerdown", on);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setHelpOpen(false), 9000);
    return () => window.clearTimeout(t);
  }, []);

  const complete = found !== null && (found.released || assignment.captured);
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    void postEnd(base, assignment.token);
    exit.current({ kind: "found", name: assignment.name, complete });
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  // The celebration leaves by itself after a while.
  useEffect(() => {
    if (found === null) return;
    const t = window.setTimeout(() => finishRef.current(), CELEBRATE_S * 1000);
    return () => window.clearTimeout(t);
  }, [found]);

  const quit = () => {
    game.current?.quit();
    exit.current({ kind: "quit" });
  };

  return (
    <div className={`play${found !== null ? " celebrating" : ""}`}>
      <div className="viewport">
        <canvas ref={canvas} />
      </div>

      {hud !== null && found === null && (
        <>
          <div className="hud-top">
            <div className="hud-where w98-raised">
              <div className="hud-where-title">
                <span className="hud-icon" aria-hidden="true">
                  ⌂
                </span>
                {hud.room}
              </div>
              {hud.location !== null && <div className="hud-where-loc">{hud.location}</div>}
            </div>
            <div className={`hud-heat heat-${hud.heat}`}>
              <span>{HEAT_LABEL[hud.heat]}</span>
              <small>{hud.heat === "steady" || hud.heat === "cold" ? `${Math.round(hud.distance)} m to Gerald` : "follow the golden arrows"}</small>
            </div>
            <div className="hud-right">
              <div className="hud-clock w98-sunken" title="time in the simulation">
                {hud.elapsed}
              </div>
              <button className="w98-button hud-quit" onClick={quit} aria-label="Leave the simulation">
                ✕
              </button>
            </div>
          </div>
          <Compass yaw={hud.yaw} pip={hud.pip} />
          <div className="hud-status">
            <span className={`led${hud.live ? " on" : ""}`} />
            {assignment.name} · {hud.others > 0 ? `${hud.others} other program${hud.others === 1 ? "" : "s"} in here` : "alone in the simulation"}
          </div>
          {hud.notice !== null && <div className="hud-notice">{hud.notice}</div>}
          {hud.idleLeft !== null && (
            <div className="hud-idle w98-raised">
              Still there? Move to stay connected — <b>{hud.idleLeft}</b>
            </div>
          )}
        </>
      )}

      {helpOpen && found === null && (
        <button className="help-card w98-raised" onClick={() => setHelpOpen(false)}>
          <span className="help-keys">
            {showSticks ? (
              <>
                <b>Left thumb</b> walks · <b>right thumb</b> turns and looks
              </>
            ) : (
              <>
                <b>W A S D</b> or arrows walk · <b>Q E</b> turn · <b>Shift</b> run · <b>drag</b> to look
              </>
            )}
          </span>
          <span className="help-goal">Find Gerald, the golden duck. Follow the golden arrows.</span>
        </button>
      )}

      {showSticks && found === null && (
        <>
          <Joystick side="left" label="MOVE" onChange={(v) => (sticks.current.left = v)} />
          <Joystick side="right" label="LOOK" onChange={(v) => (sticks.current.right = v)} />
        </>
      )}

      {found !== null && (
        <div className="celebration">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 24 }, (_, i) => (
              <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 8) * 0.18}s` }} />
            ))}
          </div>
          <Window title={complete ? "Reinstallation Wizard" : "Gerald"} className="celebrate-window">
            <div className="celebrate-body">
              <div className="egg" aria-hidden="true" />
              <div>
                <h1>{complete ? "REINSTALLATION COMPLETE" : "YOU FOUND GERALD"}</h1>
                <p>
                  {complete
                    ? `${assignment.name} has been reinstalled. Instructions followed. The Internet releases you.`
                    : `Gerald laid a golden egg for ${assignment.name}. Quack.`}
                </p>
                <ProgressBar value={1} label={complete ? "Copying files… done" : "Egg: laid"} />
                <p className="muted">{hud?.elapsed !== undefined ? `Time in the simulation: ${hud.elapsed}` : ""}</p>
              </div>
            </div>
            <div className="w98-actions">
              <button className="w98-button default" onClick={finish} autoFocus>
                Finish
              </button>
            </div>
          </Window>
        </div>
      )}
    </div>
  );
}

function Compass({ yaw, pip }: { yaw: number; pip: number | null }) {
  const bearing = bearingOf(yaw);
  return (
    <div className="compass" aria-hidden="true">
      <div className="compass-rose" style={{ transform: `rotate(${-bearing}deg)` }}>
        {(["N", "E", "S", "W"] as const).map((p, i) => (
          <span key={p} className={`cp cp-${p}`} style={{ transform: `rotate(${i * 90}deg)` }}>
            <b style={{ transform: `rotate(${-(i * 90) + bearing}deg)` }}>{p}</b>
          </span>
        ))}
      </div>
      {pip !== null && <div className="compass-pip" style={{ transform: `rotate(${pip}deg)` }} />}
      <div className="compass-needle" />
    </div>
  );
}
