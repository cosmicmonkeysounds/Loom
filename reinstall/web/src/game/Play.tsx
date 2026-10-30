//! The play screen: the canvas the `Game` renders into, the HUD over it
//! (where you are, warmer / colder, the clock, a compass whose gold pip
//! points along the trail), this visit's one ⚔ hit while the King is near
//! (wave 26, R3: his bar is drawn over his head only, never on the HUD), the twin sticks on a touch screen, the 🎤 voice link toggle (when
//! this device has it on), and the celebration when Gerald is found.
//! Wave 39: the ⚙ graphics setting (Auto / Low / Medium / High, remembered on
//! the device, never above the URL's `quality` cap). Wave 49: a prop's talk
//! (`Talk.tsx`), and in the Hallway no HUD at all but the clock and the way out.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { descentOf } from "@loom/house";
import type { Assignment, HouseMap, KingState, PlayerPose } from "@loom/house";
import { postEnd, postSuspend, type FoundAnswer } from "../api.ts";
import { baseOf, descentHint, qualityHint, type ReinstallConfig } from "../config.ts";
import { ProgressBar, Window } from "../wizard.tsx";
import type { Sfx } from "./audio.ts";
import { Game, type GameEnd, type HudState, type KingHud, type QualityHud } from "./engine.ts";
import { capOf, choiceAllowed, loadQuality, QUALITY_CHOICES, QUALITY_LABEL, saveQuality, type QualityChoice } from "./quality.ts";
import { earsLine, type VoiceHudState } from "./voice.ts";
import { HIT_USED } from "./fight.ts";
import { bearingOf, FIND_GERALD, findCopy, findOutcome, HEAT_LABEL, kingClearsHud, kingStands, type FindOutcome } from "./hud.ts";
import { CENTRED, type StickVector } from "./input.ts";
import { whyNoStart } from "./no-start.ts";
import { Joystick } from "./joystick.tsx";
import { Scare } from "./Scare.tsx";
import { Talk } from "./Talk.tsx";
import { introSkippable, tutorialCopy, type TutorialHud } from "./tutorial.ts";

export type PlayExit = { kind: "found"; name: string; outcome: FindOutcome } | { kind: "over"; reason: string } | { kind: "idle" } | { kind: "quit" };

export { NO_WEBGL2 } from "./no-start.ts";

/** Seconds the celebration stays before returning to the scanner by itself. */
const CELEBRATE_S = 15;

/** The device's graphics cap: its config's `quality`, else its page's URL
 *  (the tent terminal's link: the flow there runs under the terminal's config). */
function qualityCap(config: ReinstallConfig) {
  return capOf(config.quality ?? (typeof location === "undefined" ? null : qualityHint(location.search)));
}

/** `?lightsDemo=1` on the dev server: a synthetic lights frame (no server lane needed). */
function lightsDemo(): boolean {
  return import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).get("lightsDemo") === "1";
}

/** The walk's descent level: the page's `?descent=N` (rehearsals), else the assignment's. */
function descentLevelOf(assignment: Assignment): number {
  return (typeof location === "undefined" ? null : descentHint(location.search)) ?? descentOf(assignment);
}

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
  held = false,
  resume,
  takeMic,
  help = null,
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
  /** (wave 40) Resuming a held walk: respawn at `pose`, and skip the intro
   *  when it was already done (`ready`). */
  resume?: { pose: PlayerPose; ready: boolean };
  /** Something covers the game (a story overlay on the tent laptop, wave
   *  18b): the walk is held — `Game.hold` — never ended. */
  held?: boolean;
  /** Hand over the mic opened in the Play here tap (once; null when none). */
  takeMic?: () => Promise<MediaStream | null> | null;
  /** Wave 44 (C9): the tent's 🆘 Help Me, drawn first in the top-right row. */
  help?: ReactNode;
  onExit: (e: PlayExit) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const sticks = useRef<{ left: StickVector; right: StickVector }>({ left: CENTRED, right: CENTRED });
  const [hud, setHud] = useState<HudState | null>(null);
  const [found, setFound] = useState<FoundAnswer | null>(null);
  const [showSticks, setShowSticks] = useState(touchDevice);
  // The intro tutorial (wave 33) teaches the controls; with it off, the
  // old help card does. A walk resumed after its intro was done skips it
  // (wave 40) and drops straight back in-house.
  const tutorialOn = config.intro !== false && resume?.ready !== true;
  const [helpOpen, setHelpOpen] = useState(!tutorialOn);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const exit = useRef(onExit);
  exit.current = onExit;
  const heldRef = useRef(held);
  heldRef.current = held;
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
        ...(tutorialOn ? { intro: { touch: touchDevice(), skippable: introSkippable(assignment.reinstalled) } } : {}),
        ...(resume !== undefined ? { resumeAt: resume.pose } : {}),
        quality: { choice: loadQuality(), cap: qualityCap(config) },
        lightsDemo: lightsDemo(),
        descent: descentLevelOf(assignment),
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
    g.hold(heldRef.current);
    return () => {
      g.dispose();
      game.current = null;
    };
    // `king` only seeds the game: the stream keeps it current after that.
    // A new `config` or `sfx` object restarts the game: hosts keep both
    // stable (`flow.tsx`'s header).
  }, [house, houseVersion, assignment, base, config, sfx]);

  // Held while something covers the game; let go when it lifts.
  useEffect(() => {
    game.current?.hold(held);
  }, [held]);

  // A touch anywhere shows the sticks (a laptop with a touch screen).
  useEffect(() => {
    const on = (e: PointerEvent) => {
      if (e.pointerType === "touch") setShowSticks(true);
    };
    window.addEventListener("pointerdown", on);
    return () => window.removeEventListener("pointerdown", on);
  }, []);

  // (wave 40) The tab went to the background, or the page is going away:
  // hold the walk so the server keeps it for a short grace instead of timing
  // it out — a reload or a return within the grace resumes it. Coming back
  // visible needs nothing: the pose pump resumes and clears the hold (a
  // session the grace already dropped ends the game as any dead one does).
  useEffect(() => {
    const hide = () => {
      if (document.hidden) void postSuspend(base, assignment.token);
    };
    const away = () => void postSuspend(base, assignment.token);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", away);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", away);
    };
  }, [base, assignment.token]);

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
    // A standing King in view clears the compass and the heat line, which
    // would cover the bar over his head — his only display (wave 26, R3).
    <div className={`play${found !== null ? " celebrating" : ""}${kingClearsHud(hud?.king) ? " king-in-view" : ""}`}>
      <div className="viewport">
        <canvas ref={canvas} />
      </div>

      {hud !== null && found === null && (
        <>
          <div className="hud-top">
            {/* Wave 49: the Hallway is on no map, and no way leads to Gerald from it. */}
            {!hud.hallway && (
              <div className="hud-where w98-raised">
                <div className="hud-where-title">
                  <span className="hud-icon" aria-hidden="true">
                    ⌂
                  </span>
                  {hud.room}
                </div>
                {hud.location !== null && <div className="hud-where-loc">{hud.location}</div>}
              </div>
            )}
            {hud.hallway ? (
              <span className="spacer" />
            ) : hud.path ? (
              <div className={`hud-heat heat-${hud.heat}`}>
                <span>{HEAT_LABEL[hud.heat]}</span>
                <small>{hud.heat === "steady" || hud.heat === "cold" ? `${Math.round(hud.distance)} m to Gerald` : "follow the golden arrows"}</small>
              </div>
            ) : (
              // Before the path reveal (wave 26, R2): no label, no distance, no hint.
              <div className="hud-heat heat-hidden">
                <span>{FIND_GERALD}</span>
              </div>
            )}
            <div className="hud-right">
              {help}
              {hud.voice !== null && <MicButton voice={hud.voice} onToggle={() => game.current?.toggleMute()} />}
              <div className="hud-clock w98-sunken" title="time in the simulation">
                {hud.elapsed}
              </div>
              {/* DRAFT w39 (UI copy) */}
              <button className="w98-button hud-gear" onClick={() => setSettingsOpen((o) => !o)} aria-label="Graphics settings" aria-expanded={settingsOpen} title="Graphics">
                ⚙
              </button>
              <button className="w98-button hud-quit" onClick={quit} aria-label="Leave the simulation">
                ✕
              </button>
            </div>
          </div>
          {!hud.hallway && <Compass yaw={hud.yaw} pip={hud.pip} />}
          <div className="hud-status">
            <span className={`led${hud.live ? " on" : ""}`} />
            {assignment.name} · {hud.others > 0 ? `${hud.others} other program${hud.others === 1 ? "" : "s"} in here` : "alone in the simulation"}
            {hud.voice !== null && earsLine(hud.voice) !== null && <> · {earsLine(hud.voice)}</>}
          </div>
          {settingsOpen && (
            <QualityMenu
              quality={hud.quality}
              onPick={(c) => {
                saveQuality(c);
                game.current?.setQuality(c);
              }}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          {hud.king !== null && <KingActions king={hud.king} onHit={() => game.current?.hit()} />}
          {hud.notice !== null && <div className="hud-notice">{hud.notice}</div>}
          {hud.caption !== null && (
            // A line said in-game (wave 26): the display text, never the pronounced
            // one, and no speaker's name (he may not have been introduced yet).
            // w26 (R4, R6) UI copy: the caption window's title.
            <Window title="Message" icon="💬" className={`hud-caption${showSticks ? " over-sticks" : ""}`}>
              <p>{hud.caption.text}</p>
            </Window>
          )}
          {hud.talk !== null && <Talk talk={hud.talk} touch={showSticks} onPick={(i) => game.current?.talkPick(i)} />}
          {hud.idleLeft !== null && (
            <div className="hud-idle w98-raised">
              Still there? Move to stay connected — <b>{hud.idleLeft}</b>
            </div>
          )}
        </>
      )}

      {hud?.tutorial != null && found === null && <TutorialCard tutorial={hud.tutorial} touch={showSticks} onSkip={() => game.current?.skipTutorial()} />}

      {hud !== null && hud.tutorial === null && hud.mouseHint && !showSticks && found === null && hud.caption === null && hud.talk === null && (
        <div className="mouse-hint w98-raised" aria-hidden="true">
          🖱 Click the picture to look around with the mouse
        </div>
      )}

      {hud?.scare === true && found === null && <Scare />}

      {helpOpen && found === null && (
        <button className="help-card w98-raised" onClick={() => setHelpOpen(false)}>
          <span className="help-keys">
            {showSticks ? (
              <>
                <b>Left thumb</b> walks · <b>right thumb</b> turns and looks
                {kingStands(hud?.king) && (
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
                {kingStands(hud?.king) && (
                  <>
                    {" "}
                    · <b>Space</b> hits the King
                  </>
                )}
              </>
            )}
          </span>
          {/* w26 (R2): no arrows promised — the trail draws after a minute. */}
          <span className="help-goal">Find Gerald, the golden duck.</span>
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
                {hud?.foundLine != null && <p className="found-line">{hud.foundLine}</p>}
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

/** The intro tutorial's card (wave 33): one step at a time, done by doing
 *  it, with a progress bar; Skip only for a program that completed a
 *  reinstallation. */
function TutorialCard({ tutorial, touch, onSkip }: { tutorial: TutorialHud; touch: boolean; onSkip: () => void }) {
  const copy = tutorialCopy(tutorial.step, touch);
  return (
    <Window title={`Training — step ${tutorial.index} of ${tutorial.total}`} icon="🎓" className={`tutorial-card step-${tutorial.step}${touch ? " over-sticks" : ""}`}>
      <h2>{copy.title}</h2>
      <p>{copy.line}</p>
      {tutorial.step !== "done" && tutorial.step !== "click" && <ProgressBar value={tutorial.progress} />}
      {tutorial.skippable && (
        <div className="w98-actions">
          <button className="w98-button" onClick={onSkip}>
            Skip training ▶
          </button>
        </div>
      )}
    </Window>
  );
}

/** The ⚙ menu (wave 39): the graphics setting. Auto says the tier it draws
 *  now; a tier over the device's cap is off. DRAFT w39 (UI copy). */
function QualityMenu({ quality, onPick, onClose }: { quality: QualityHud; onPick: (c: QualityChoice) => void; onClose: () => void }) {
  return (
    <Window title="Graphics" icon="⚙" className="quality-menu" onClose={onClose}>
      <div role="radiogroup" aria-label="Graphics quality">
        {QUALITY_CHOICES.map((c) => (
          <label key={c} className={`radio${choiceAllowed(c, quality.cap) ? "" : " off"}`}>
            <input type="radio" name="quality" checked={quality.choice === c} disabled={!choiceAllowed(c, quality.cap)} onChange={() => onPick(c)} />
            {QUALITY_LABEL[c]}
            {c === "auto" && quality.choice === "auto" && <span className="muted"> — {QUALITY_LABEL[quality.tier].toLowerCase()} now</span>}
          </label>
        ))}
      </div>
      <p className="muted small">Lower is smoother on an older computer.</p>
    </Window>
  );
}

/** ⚔ HIT while the King is near and standing — spent (disabled, with the
 *  line why) once this visit has hit him. No bar, meter or stage line: the
 *  bar over his head is the only King display (wave 26, R3). */
function KingActions({ king, onHit }: { king: KingHud; onHit: () => void }) {
  const near = king.verdict !== "far" && king.verdict !== "floor";
  if (king.fallen || !near) return null;
  return (
    <div className="king-actions">
      <button
        className="w98-button big default"
        onClick={onHit}
        disabled={king.hitUsed || king.hitting}
        title={king.hitUsed ? HIT_USED : undefined}
        aria-label="Hit the King"
      >
        ⚔ HIT
      </button>
    </div>
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
