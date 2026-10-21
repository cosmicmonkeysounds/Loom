//! The reinstallation flow for one scanned program (wave 18b, lifted out
//! of `app.tsx` so the tent laptop's terminal can mount it too, inside a
//! shadow root — `terminal/src/reinstall/`):
//!
//!   choose   — **Play here** or **Send to <station>** (the King note, the
//!              not-marked refusal, the no-WebGL2 line);
//!   starting — the begin, then the dealt map;
//!   sent     — parked for a headset: "put the headset on" (back by itself);
//!   play     — the simulation (`game/Play.tsx`).
//!
//! It never scans and never polls: the host passes the program, the night's
//! `ended`, the stations and the sounds, and hears how it ended (`onExit`).
//! `start: "choose"` always shows the card (the standalone wizard);
//! `"auto"` asks `firstStep` (the tent laptop: straight to Play here when no
//! headset is online, once a station poll has answered). The begin never
//! sends `force`: the server's marked-only gate decides (wave 16, R16).
//!
//! **Keep `config` and `sfx` referentially stable** across the host's
//! renders. `Play` restarts the game when either is a new object (it drops
//! the walk and re-claims the session), and `useStations` / `useNightEnded`
//! re-subscribe on a new `config`. A host that re-renders on every poll (the
//! tent laptop's terminal) builds them once — `useMemo(() => createSfx(
//! soundOutput), [])`, disposed on unmount, and a memoised config — never
//! inline in the JSX.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Assignment, HouseMap, KingState, StationInfo } from "@loom/house";
import { ApiError, begin, fetchDealtHouse, fetchNightEnded, fetchStations, postEnd } from "./api.ts";
import { baseOf, type ReinstallConfig } from "./config.ts";
import type { Sfx } from "./game/audio.ts";
import { findFlash } from "./game/hud.ts";
import { NO_WEBGL2, Play, type PlayExit } from "./game/Play.tsx";
import { beginErrorText, NOT_MARKED, programPitch, programState, programStatus, startingHeading, type Program } from "./program.ts";
import { firstStep } from "./flow-state.ts";
import { showHouse } from "./show-house.ts";
import { Desktop, ProgressBar, Window, Wizard } from "./wizard.tsx";

/** How the flow ended: the game's own exits, a park on a headset, Back on
 *  the card, or a begin / map load that failed (its words in `text`). */
export type FlowExit = PlayExit | { kind: "sent"; station: string } | { kind: "back" } | { kind: "failed"; text: string };

/** The VR stations as the host polls them (`useStations`). */
export interface FlowStations {
  list: StationInfo[];
  /** The last poll answered. */
  ok: boolean;
  /** Poll again now (after a send). */
  refresh: () => void;
}

/** The bundled map has a King (a `king` prop): the choose screen says what to do about him. */
export const HAS_KING = showHouse.props.some((p) => p.kind === "king");

/** "Sent" goes back by itself after this long (ms). */
export const SENT_BACK_MS = 9000;

type Step =
  | { kind: "choose" }
  | { kind: "starting"; label: string }
  | { kind: "sent"; station: string }
  | { kind: "play"; assignment: Assignment; house: HouseMap; houseVersion: string; king?: KingState | null };

export function ReinstallFlow({
  config,
  program,
  ended,
  stations,
  canDraw,
  sfx,
  held = false,
  start,
  status,
  onPlaying,
  onExit,
}: {
  /** Stable across renders (see the header): a new object restarts the game. */
  config: ReinstallConfig;
  program: Program;
  /** An ending has played: the reinstallation is a party favour. */
  ended: boolean;
  stations: FlowStations;
  /** This browser has WebGL2 (it can play here). */
  canDraw: boolean;
  /** Stable across renders (see the header): a new object restarts the game. */
  sfx: Sfx;
  /** Something covers the game (a story overlay on the tent laptop): the
   *  walk is held — the leash paused, input ignored, the pose kept alive. */
  held?: boolean;
  start: "choose" | "auto";
  /** The desktop's status corner (the standalone wizard's headset LEDs). */
  status?: ReactNode;
  /** The game is on screen (true) or not (false). */
  onPlaying?: (playing: boolean) => void;
  onExit: (e: FlowExit) => void;
}) {
  const vr = stations.list.filter((s) => s.world === "vr");
  // `auto` decides once, at mount: on stations it has heard from (null =
  // no poll has answered yet, so the card — a headset may be ready, D8).
  const [first] = useState(() => (start === "auto" ? firstStep(program, ended, config.role, stations.ok ? vr.filter((s) => s.online).length : null, canDraw) : "choose"));
  const [step, setStep] = useState<Step>(() => (first === "play" ? { kind: "starting", label: "Copying files…" } : { kind: "choose" }));
  const exit = useRef(onExit);
  exit.current = onExit;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const playing = step.kind === "play";
  const playingRef = useRef(onPlaying);
  playingRef.current = onPlaying;
  useEffect(() => {
    playingRef.current?.(playing);
  }, [playing]);
  useEffect(() => () => playingRef.current?.(false), []);

  const playHere = async () => {
    sfx.resume();
    setStep({ kind: "starting", label: "Copying files…" });
    try {
      const assignment = await begin(config, program.id, "web");
      if (!alive.current) {
        void postEnd(baseOf(config), assignment.token);
        return;
      }
      setStep({ kind: "starting", label: "Building the simulation…" });
      // Only the map the server dealt on: the spawn and Gerald's spot are
      // placed on it (never the bundled stand-in, never another version).
      const loaded = await fetchDealtHouse(baseOf(config), assignment.token, assignment.houseVersion);
      if (loaded === null || !alive.current) {
        void postEnd(baseOf(config), assignment.token);
        if (alive.current) exit.current({ kind: "failed", text: "Couldn't load the house — scan the pass again." });
        return;
      }
      setStep({ kind: "play", assignment, house: loaded.house, houseVersion: loaded.version, ...(loaded.king !== undefined ? { king: loaded.king } : {}) });
    } catch (e) {
      if (alive.current) exit.current({ kind: "failed", text: beginError(e) });
    }
  };

  const sendTo = async (s: StationInfo) => {
    setStep({ kind: "starting", label: `Sending to ${s.name || s.id}…` });
    try {
      await begin(config, program.id, "vr", s.id);
      if (!alive.current) return;
      setStep({ kind: "sent", station: s.name || s.id });
      stations.refresh();
    } catch (e) {
      if (alive.current) exit.current({ kind: "failed", text: beginError(e) });
    }
  };

  // `auto`: the first step decided at mount — Play here at once, or the
  // card; a program the server would turn away never begins.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (first === "refuse") exit.current({ kind: "failed", text: NOT_MARKED });
    else if (first === "play") void playHere();
  }, []);

  // "Sent" goes back by itself.
  useEffect(() => {
    if (step.kind !== "sent") return;
    const station = step.station;
    const t = window.setTimeout(() => exit.current({ kind: "sent", station }), SENT_BACK_MS);
    return () => window.clearTimeout(t);
  }, [step]);

  if (step.kind === "play") {
    return (
      <Play
        config={config}
        assignment={step.assignment}
        house={step.house}
        houseVersion={step.houseVersion}
        {...(step.king !== undefined ? { king: step.king } : {})}
        sfx={sfx}
        held={held}
        onExit={(e: PlayExit) => exit.current(e)}
      />
    );
  }

  // Turned away at mount: nothing to show while the host hears why.
  if (first === "refuse") return null;
  const state = programState(program, ended);
  const info = programStatus(program, ended);
  return (
    <Desktop status={status}>
      <Window title={`Reinstallation Wizard — ${config.name}`} className="main-window">
        {step.kind === "choose" && (
          <Wizard
            step={2}
            total={3}
            heading={info.heading}
            actions={
              <>
                <button className="w98-button" onClick={() => exit.current({ kind: "back" })}>
                  &lt; Back
                </button>
                <span className="spacer" />
                {config.role !== "station" && (
                  <button className="w98-button default big" onClick={() => void playHere()} disabled={!canDraw || !program.eligible} autoFocus={canDraw && program.eligible}>
                    Play here &gt;
                  </button>
                )}
              </>
            }
          >
            <div className="program-card w98-sunken">
              <div className="program-icon" aria-hidden="true">
                {info.icon}
              </div>
              <div>
                <div className="program-name">{program.name}</div>
                <div className="program-meta">
                  {info.status}
                  {program.location !== null && <> · in {program.location}</>}
                </div>
              </div>
            </div>
            <p className="program-pitch">{programPitch(state)}</p>
            {HAS_KING && config.role !== "station" && state !== "favour" && (
              <p className="king-note">Find Gerald. In the simulation the King guards the Server Room's door: every program may hit him once per reinstallation, and every hit weakens him for everyone.</p>
            )}
            {!program.eligible && (
              <div className="w98-error not-marked" role="alert">
                ⚠ {NOT_MARKED}
              </div>
            )}
            {!canDraw && config.role !== "station" && program.eligible && <div className="w98-error">⚠ {NO_WEBGL2}</div>}
            {config.role !== "player" && (
              <fieldset className="w98-group">
                <legend>Send to a headset</legend>
                {vr.length === 0 && <div className="muted">No headsets have checked in.</div>}
                <div className="station-buttons">
                  {vr.map((s) => (
                    <button key={s.id} className="w98-button station" disabled={!program.eligible || !s.online || s.busy !== null} onClick={() => void sendTo(s)}>
                      <span className={`led${s.online ? " on" : ""}`} />
                      <span>
                        Send to <b>{s.name || s.id}</b>
                        <small>{!s.online ? "offline" : s.busy !== null ? `busy — ${s.busy.name}` : "ready"}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </Wizard>
        )}
        {step.kind === "starting" && (
          <Wizard step={3} total={3} heading={startingHeading(state, program.name)}>
            <p>{step.label}</p>
            <IndeterminateBar />
          </Wizard>
        )}
        {step.kind === "sent" && (
          <Wizard
            step={3}
            total={3}
            heading={`Sent to ${step.station}`}
            actions={
              <>
                <span className="spacer" />
                <button className="w98-button default big" onClick={() => exit.current({ kind: "sent", station: step.station })} autoFocus>
                  OK
                </button>
              </>
            }
          >
            <p className="sent-big">
              <b>{program.name}</b>: put the headset on.
            </p>
            <p>The simulation starts the moment the headset wakes. Use the thumbsticks: left walks, right turns.</p>
            <ProgressBar value={1} label="Transferred" />
          </Wizard>
        )}
      </Window>
    </Desktop>
  );
}

/** A flow's end as the scan screen's flash (null: nothing to say — Back, or
 *  a park, whose own screen said it). */
export function exitFlash(e: FlowExit): { text: string; tone: "good" | "bad" } | null {
  switch (e.kind) {
    case "found":
      return findFlash(e.outcome, e.name);
    case "over":
      return { text: e.reason, tone: "bad" };
    case "idle":
      return { text: "Disconnected — nobody touched the controls for two minutes.", tone: "bad" };
    case "quit":
      return { text: "Simulation aborted.", tone: "bad" };
    case "failed":
      return { text: e.text, tone: "bad" };
    case "sent":
    case "back":
      return null;
  }
}

export function beginError(e: unknown): string {
  return beginErrorText(e instanceof ApiError ? e.status : null, (e as Error).message);
}

export function IndeterminateBar() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setN((x) => (x + 1) % 26), 90);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="w98-progress w98-sunken indeterminate">
      {Array.from({ length: 20 }, (_, i) => (
        <span key={i} className={i >= n - 6 && i < n ? "on" : ""} />
      ))}
    </div>
  );
}

// --- what the host polls ----------------------------------------------------------

const STATION_POLL_MS = 2000;
/** `night.ended` off the screen state, every `ENDED_POLL_MS` (false until it says so). */
const ENDED_POLL_MS = 15_000;

export function useNightEnded(config: ReinstallConfig): boolean {
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const e = await fetchNightEnded(config);
      if (alive && e !== null) setEnded(e);
    };
    void poll();
    const t = window.setInterval(() => void poll(), ENDED_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [config]);
  return ended;
}

export function useStations(config: ReinstallConfig, enabled: boolean): FlowStations {
  const [list, setList] = useState<StationInfo[]>([]);
  const [ok, setOk] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const poll = async () => {
      try {
        const s = await fetchStations(config);
        if (!alive) return;
        setList(s);
        setOk(true);
      } catch {
        if (alive) setOk(false);
      }
    };
    void poll();
    const t = window.setInterval(() => void poll(), STATION_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [config, enabled, tick]);
  return { list, ok: ok || !enabled, refresh: () => setTick((t) => t + 1) };
}
