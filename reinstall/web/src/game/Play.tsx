//! The play screen: the canvas the `Game` renders into, the HUD over it
//! (where you are, warmer / colder, the clock, a compass whose gold pip
//! points along the trail), the King's shared bar with this visit's one ⚔
//! hit, the twin sticks on a touch screen, the 🎤 voice link toggle (when
//! this device has it on), and the celebration when Gerald is found.

import { useEffect, useRef, useState } from "react";
import type { Assignment, HouseMap, KingState } from "@loom/house";
import { postEnd, type FoundAnswer } from "../api.ts";
import { baseOf, type ReinstallConfig } from "../config.ts";
import { ProgressBar, Window } from "../wizard.tsx";
import type { Sfx } from "./audio.ts";
import { Game, type GameEnd, type HudState, type KingHud } from "./engine.ts";
import { earsLine, type VoiceHudState } from "./voice.ts";
import { HIT_USED, KNEELING_LINE, STAGE_LINE } from "./fight.ts";
import { bearingOf, findCopy, findOutcome, HEAT_LABEL, type FindOutcome } from "./hud.ts";
import { CENTRED, type StickVector } from "./input.ts";
import { whyNoStart } from "./no-start.ts";
import { Joystick } from "./joystick.tsx";

export type PlayExit = { kind: "found"; name: string; outcome: FindOutcome } | { kind: "over"; reason: string } | { kind: "idle" } | { kind: "quit" };

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
  king,
  sfx,
  takeMic,
  onExit,
}: {
  config: ReinstallConfig;
  assignment: Assignment;
  house: HouseMap;
  /** The version of `house` (the stream's `hello` / `house` frames are compared with it). */
  houseVersion: string;
  /** The shared King off the dealt map's GET (absent: an old server — no ⚔). */
  king?: KingState | null;
  sfx: Sfx;
  /** Hand over the mic opened in the Play here tap (once; null when none). */
  takeMic?: () => Promise<MediaStream | null> | null;
  onExit: (e: PlayExit) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const sticks = useRef<{ left: StickVector; right: StickVector }>({ left: CENTRED, right: CENTRED });
  const [hud, setHud] = useState<HudState | null>(null);
  const [found, setFound] = useState<FoundAnswer | null>(null);
  const [showSticks, setShowSticks] = useState(touchDevice);
  const [helpOpen, setHelpOpen] = useState(true);
  const exit = useRef(onExit);
  exit.current = onExit;
  const base = baseOf(config);

  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    let g: Game;
    const mic = takeMic?.() ?? null;
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
        ...(king !== undefined ? { king } : {}),
        voice: config.voice,
        mic,
      });
    } catch (e) {
      void mic?.then((s) => s?.getTracks().forEach((t) => t.stop()));
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
    // `king` only seeds the game: the stream keeps it current after that.
  }, [house, houseVersion, assignment, base, config, sfx]);

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

  // The server's `released` is the only proof of a release: a program the
  // story keeps captured (the banishment) is told Gerald can't help.
  const outcome: FindOutcome = found === null ? "found" : findOutcome(found, assignment.captured);
  const copy = findCopy(outcome, assignment.name);
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    void postEnd(base, assignment.token);
    exit.current({ kind: "found", name: assignment.name, outcome });
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
              {hud.voice !== null && <MicButton voice={hud.voice} onToggle={() => game.current?.toggleMute()} />}
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
            {hud.voice !== null && earsLine(hud.voice) !== null && <> · {earsLine(hud.voice)}</>}
          </div>
          {hud.king !== null && <KingBar king={hud.king} onHit={() => game.current?.hit()} />}
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
                {hud?.king !== null && hud?.king !== undefined && (
                  <>
                    {" "}
                    · <b>⚔</b> by the King
                  </>
                )}
              </>
            ) : (
              <>
                <b>W A S D</b> or arrows walk · <b>Q E</b> turn · <b>Shift</b> run · <b>drag</b> to look
                {config.voice && (
                  <>
                    {" "}
                    · <b>M</b> mutes the mic
                  </>
                )}
                {hud?.king !== null && hud?.king !== undefined && (
                  <>
                    {" "}
                    · <b>Space</b> hits the King
                  </>
                )}
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
        <div className={`celebration${copy.egg ? "" : " refused"}`}>
          {copy.egg && (
            <div className="confetti" aria-hidden="true">
              {Array.from({ length: 24 }, (_, i) => (
                <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 8) * 0.18}s` }} />
              ))}
            </div>
          )}
          <Window title={copy.title} className="celebrate-window">
            <div className="celebrate-body">
              {copy.egg && <div className="egg" aria-hidden="true" />}
              <div>
                <h1>{copy.heading}</h1>
                <p>{copy.line}</p>
                <ProgressBar value={1} label={copy.progress} />
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

/** The King's shared bar under the top HUD, and ⚔ HIT when he is near —
 *  spent (disabled, with the line why) once this visit has hit him. */
function KingBar({ king, onHit }: { king: KingHud; onHit: () => void }) {
  if (king.fallen) {
    return (
      <div className="hud-king open">
        <span className="hud-king-label">♚ {king.label}</span>
        <span className="hud-king-state">KNEELING · {king.meter}</span>
        <small>{KNEELING_LINE}</small>
      </div>
    );
  }
  const near = king.verdict !== "far" && king.verdict !== "floor";
  return (
    <>
      <div className={`hud-king${near ? " near" : ""}`}>
        <span className="hud-king-label">⚔ {king.label}</span>
        <span className="hud-king-hearts">{king.meter}</span>
        <small>{king.hitUsed ? HIT_USED : STAGE_LINE[king.stage]}</small>
      </div>
      {near && (
        <div className="king-actions">
          <button className="w98-button big default" onClick={onHit} disabled={king.hitUsed || king.hitting} aria-label="Hit the King">
            ⚔ HIT
          </button>
        </div>
      )}
    </>
  );
}

const MIC_LABEL: Record<VoiceHudState["mic"], string> = { live: "LIVE", muted: "MUTED", none: "NO MIC", starting: "…" };
const MIC_TITLE: Record<VoiceHudState["mic"], string> = {
  live: "The terminals near you hear you when you speak — tap to mute (M)",
  muted: "Muted — tap to be heard again (M)",
  none: "No microphone: allow it for this page (it needs https), or play without",
  starting: "Opening the microphone…",
};

/** The voice link's 🎤: LIVE / MUTED (tap toggles), or NO MIC. */
function MicButton({ voice, onToggle }: { voice: VoiceHudState; onToggle: () => void }) {
  const can = voice.mic === "live" || voice.mic === "muted";
  return (
    <button className={`w98-button hud-mic mic-${voice.mic}`} onClick={onToggle} disabled={!can} title={MIC_TITLE[voice.mic]} aria-label={MIC_TITLE[voice.mic]} aria-pressed={voice.mic === "muted"}>
      🎤 {MIC_LABEL[voice.mic]}
    </button>
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
