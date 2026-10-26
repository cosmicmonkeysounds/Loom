//! The tent laptop (wave 18b, `view=reinstall`): one device that is a wall
//! terminal **and** the reinstallation wizard. A lazy chunk (`app.tsx`'s
//! `ReinstallSlot`), awake all night like the King's board and the casino;
//! the screens are `session.ts`'s (pure).
//!
//! Idle (wave 26, T3), it is a scan kiosk: a centred Win98 Reinstallation
//! Wizard card with the large live camera, the typed-name field and the
//! programs in the Internet now as big buttons, over the idle show as a
//! dimmed quiet backdrop (never naming Trabolta before his introduction:
//! `asleep` is its naming gate). It takes no story slide, countdown corner
//! or Y2K clock (the app's `slides: false`); overlays, beat cutscenes and
//! the glitch still play. It draws no world and is never linked to the
//! Internet (R5: every walk starts in its room): no camera into the game, no
//! voice link. A `tablet_*` cue (the story's capture) is a status line in the
//! card that names nobody. A pass is checked against the spatial candidates:
//! a program the server would turn away gets the NOT MARKED card and
//! nothing else (no story effect, D8 / O6); a marked or captured one gets
//! the reinstall app's own flow full screen (`pane.tsx`): straight to Play
//! here, or the choose card when a headset is online.
//!
//! The contract with the app:
//! - `onBusy(true)` while the flow is on screen: the app's screen layer
//!   then treats this terminal as piloting, so story slides and beat
//!   cutscenes stand aside; `onBusy(false)` when it is back to idle.
//! - `takeover`: a story overlay (blackout / alarm / go to the living room)
//!   covers the screen — the walk is **held** (`ReinstallFlow`'s `held`),
//!   never ended; the scanner stops under it.
//! - Sounds: the game's go through the page's master bus
//!   (`createSfx(soundOutput)`, built once), the station's through `sfx()`.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./reinstall.css";
import { ApiError, fetchCandidates } from "@loom/reinstall/api.ts";
import { createSfx } from "@loom/reinstall/game/audio.ts";
import { useStations, type FlowExit } from "@loom/reinstall/flow.tsx";
import type { Program } from "@loom/reinstall/program.ts";
import type { TerminalConfig } from "../config.ts";
import type { ScreenState } from "../screen.ts";
import { useSpatialStream, useWorld, type Gone } from "../world/stream.ts";
import { countsLine } from "../world/overlay.ts";
import { hasWebGL2 } from "../webgl.ts";
import { Gear, TypedFallback } from "../controls.tsx";
import { Scanner, cameraProblem, type CameraState } from "../scanner.tsx";
import { IdleShow } from "../idle-show/IdleShow.tsx";
import { SCAN_COPY } from "../idle-show/scan-copy.ts";
import { sfx, soundOutput } from "../sound/bus.ts";
import { reinstallConfigOf } from "./adapter.ts";
import { ReinstallPane } from "./pane.tsx";
import { INITIAL, PICKS_POLL_MS, exitSound, insideNow, isBusy, playingOn, reduce, refusedCopy, timed, type StationSession } from "./session.ts";

export interface ReinstallTerminalProps {
  config: TerminalConfig;
  state: ScreenState | null;
  /** The screen-state poll is answering. */
  polled: boolean;
  /** A story overlay covers the screen: hold a walk, never end it. */
  takeover: boolean;
  /** A slide or an overlay covers the screen: the idle show pauses under it. */
  covered: boolean;
  /** The character is hidden or asleep: the idle show's naming gate (nothing
   *  names Trabolta before the introduction). Never a screensaver here. */
  asleep: boolean;
  onSetup: () => void;
  /** The spatial stream was refused for good (access revoked / event over). */
  onGone: (g: Gone) => void;
  /** A walk (or the wizard) is on screen (true), or back to idle (false). */
  onBusy: (busy: boolean) => void;
}

export function ReinstallTerminal({ config, state, polled, takeover, covered, asleep, onSetup, onGone, onBusy }: ReinstallTerminalProps) {
  const [s, dispatch] = useReducer(reduce, INITIAL);
  const busy = isBusy(s);
  useEffect(() => onBusy(busy), [busy, onBusy]);

  // Built once (the flow restarts its game on a new config or sfx object).
  const { eventId, title, token, name, camera: facing } = config;
  const rconfig = useMemo(() => reinstallConfigOf({ eventId, title, token, name, camera: facing }), [eventId, title, token, name, facing]);
  const gameSfx = useMemo(() => createSfx(soundOutput), []);
  useEffect(() => () => gameSfx.dispose(), [gameSfx]);
  const canDraw = useMemo(() => hasWebGL2(), []);
  const ended = state?.night.ended === true;

  // The headsets (the flow's choose card), not under the game.
  const [playing, setPlaying] = useState(false);
  const stations = useStations(rconfig, !playing);

  // The simulation: who walks it now (the status bar's count, and "already reinstalling").
  const world = useSpatialStream(config, !busy);
  const players = useWorld(world, (w) => w.world.players);
  const gone = useWorld(world, (w) => w.gone);
  useEffect(() => {
    if (gone !== null) onGone(gone);
  }, [gone, onGone]);

  // --- the quick picks: the programs in the Internet now ---
  const [picks, setPicks] = useState<Program[]>([]);
  const idle = s.step.kind === "idle" || s.step.kind === "refused";
  useEffect(() => {
    if (busy) return;
    let alive = true;
    const poll = () =>
      void fetchCandidates(rconfig).then(
        (roster) => alive && setPicks(insideNow(roster, ended)),
        () => alive && setPicks([]),
      );
    poll();
    const t = window.setInterval(poll, PICKS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [busy, rconfig, ended]);

  // --- a pass was read: who is it, may they play here? ---
  const playersRef = useRef(players);
  playersRef.current = players;
  const endedRef = useRef(ended);
  endedRef.current = ended;
  const stationsRef = useRef(stations.list);
  stationsRef.current = stations.list;
  const checking = s.step.kind === "checking" ? s.step.id : null;
  useEffect(() => {
    if (checking === null) return;
    let alive = true;
    void fetchCandidates(rconfig).then(
      (roster) => {
        if (!alive) return;
        const program = roster.find((p) => p.id === checking) ?? null;
        dispatch({ type: "resolved", id: checking, program, ended: endedRef.current, playingOn: program === null ? null : playingOn(playersRef.current.values(), program.id, stationsRef.current), now: Date.now() });
      },
      (e: unknown) => alive && dispatch({ type: "lookupFailed", id: checking, status: e instanceof ApiError ? e.status : null, message: (e as Error).message, now: Date.now() }),
    );
    return () => {
      alive = false;
    };
  }, [checking, rconfig]);

  // --- the story's capture cue: the wizard card ---
  const cueSeq = state === null ? undefined : (state.cues.tablet?.seq ?? null);
  useEffect(() => {
    if (cueSeq !== undefined) dispatch({ type: "cue", seq: cueSeq, now: Date.now() });
  }, [cueSeq]);
  const cardUp = s.card !== null;
  useEffect(() => {
    if (cardUp) sfx("startup");
  }, [cardUp]);
  const refusedUp = s.step.kind === "refused";
  useEffect(() => {
    if (refusedUp) sfx("error");
  }, [refusedUp]);

  // Cards and flashes count down.
  const ticking = timed(s);
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 500);
    return () => window.clearInterval(t);
  }, [ticking]);

  const onExit = useCallback((e: FlowExit) => {
    const sound = exitSound(e);
    if (sound !== null) sfx(sound, { over: true });
    dispatch({ type: "exit", exit: e, now: Date.now() });
  }, []);
  const onCode = useCallback((text: string) => {
    sfx("blip", { gain: 0.6 });
    dispatch({ type: "scan", text, now: Date.now() });
  }, []);

  // --- the walk ---
  if (s.step.kind === "flow") {
    return (
      <ReinstallPane
        run={s.step.run}
        config={rconfig}
        program={s.step.program}
        ended={ended}
        stations={stations}
        canDraw={canDraw}
        sfx={gameSfx}
        held={takeover}
        start="auto"
        onPlaying={setPlaying}
        onExit={onExit}
      />
    );
  }

  return (
    <Station
      config={config}
      state={state}
      polled={polled}
      takeover={takeover}
      covered={covered}
      asleep={asleep}
      s={s}
      picks={idle ? picks : []}
      reinstalling={players.size > 0 ? players.size : (state?.reinstalling ?? 0)}
      onSetup={onSetup}
      onCode={onCode}
      onPick={(id) => dispatch({ type: "pick", id })}
      onProblem={(text) => dispatch({ type: "problem", text, now: Date.now() })}
      onConfirm={() => dispatch({ type: "confirm" })}
      onCancel={() => dispatch({ type: "cancel" })}
    />
  );
}

/**
 * The station while nobody walks here (wave 26, T3): a scan kiosk. A centred
 * Win98 *Reinstallation Wizard* card holds the large live camera (the page's
 * one stream: `<Scanner>`), the typed-name field (always shown, focused only
 * while idle with no card up) and the programs in the Internet now as big
 * buttons; a capture cue (`tablet_*`) is a status line in the card, never a
 * modal over the scanner. Behind it the idle show plays as a dimmed, quiet
 * backdrop (`IdleShow` `quiet`: no storm unless hijacked, one window at most,
 * no TOUCH ME, no face). No world pane: the walkers are the TV's and the
 * walls' to show (R5); the card's status bar says how many are reinstalling.
 */
function Station({
  config,
  state,
  polled,
  takeover,
  covered,
  asleep,
  s,
  picks,
  reinstalling,
  onSetup,
  onCode,
  onPick,
  onProblem,
  onConfirm,
  onCancel,
}: {
  config: TerminalConfig;
  state: ScreenState | null;
  polled: boolean;
  takeover: boolean;
  covered: boolean;
  asleep: boolean;
  s: StationSession;
  picks: Program[];
  /** Programs walking the simulation now (the status bar's count). */
  reinstalling: number;
  onSetup: () => void;
  onCode: (text: string) => void;
  onPick: (id: string) => void;
  onProblem: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [camera, setCamera] = useState<CameraState>("starting");
  // The idle show keeps its popups off the whole card.
  const card = useRef<HTMLElement>(null);
  const step = s.step;
  const checking = step.kind === "checking";
  const ended = state?.night.ended === true;
  const scanning = step.kind === "idle" || step.kind === "refused";
  // The typed field takes the focus only while the station waits, no card up.
  const typingFocus = step.kind === "idle" && !takeover && s.notice === null;
  const wizardUp = s.card !== null && step.kind === "idle";
  const problem = cameraProblem(camera);
  const counts = countsLine({ total: reinstalling, here: 0 }, false);
  return (
    <div className="terminal reinstall attract station">
      <header className="bar">
        <span className="bar-left">
          <span className="dot" data-on={String(polled)} />
          {config.title ? `${config.title} · ` : ""}TERMINAL {config.name.toUpperCase()}
        </span>
        <span className="bar-mid">REINSTALLATION STATION</span>
        <span className="bar-right">
          <Gear onOpen={onSetup} label="Set up this terminal" />
        </span>
      </header>

      <main className="stage idle ri-stage">
        <IdleShow name={config.name} state={state} asleep={asleep} character={config.character} target="wall" active={!covered} region="full" reserveRef={card} quiet />
        <section ref={card} className="ri-station" aria-label="Reinstallation Wizard">
          <div className="ri-station-title">💿 Reinstallation Wizard</div>
          <div className="ri-station-body">
            <div className="ri-station-cam">
              <Scanner facing={config.camera} active={!takeover && scanning} onCode={onCode} onState={setCamera} />
            </div>
            <div className="ri-station-words">
              <div className="ri-station-scan">{SCAN_COPY.title}</div>
              <div className="ri-station-hint">{SCAN_COPY.hint}</div>
              {problem !== null && <div className="ri-station-problem">{problem}</div>}
            </div>
            <div className="ri-station-typed">
              <div className="ri-station-label">{SCAN_COPY.typed}</div>
              <TypedFallback config={config} focus={typingFocus} clearOnPick onPick={onPick} onProblem={onProblem} />
            </div>
            {picks.length > 0 && (
              <div className="ri-picks" aria-label="In the Internet now">
                <div className="ri-picks-title">☣ IN THE INTERNET NOW</div>
                <div className="ri-picks-list">
                  {picks.map((p) => (
                    <button key={p.id} type="button" className="link ri-pick" disabled={checking} onClick={() => onPick(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {wizardUp && <WizardStatus />}
          </div>
          <div className="ri-station-status" role="status">
            {counts}
          </div>
        </section>
      </main>

      {checking && (
        <div className="ri-card ri-checking" role="status">
          <div className="big blink">READING PASS…</div>
        </div>
      )}
      {step.kind === "refused" && <Refused program={step.program} ended={ended} onClose={onCancel} />}
      {step.kind === "confirm" && (
        <div className="ri-card ri-confirm" role="alertdialog" aria-label="Already reinstalling">
          <div className="ri-card-icon" aria-hidden="true">
            ⚠
          </div>
          <div className="ri-card-heading">
            {step.program.name.toUpperCase()} IS ALREADY REINSTALLING ON {step.device.toUpperCase()}
          </div>
          <div className="ri-card-text">Play here instead? That ends the walk on {step.device}.</div>
          <div className="ri-card-actions">
            <button type="button" className="link ri-button" onClick={onCancel}>
              CANCEL
            </button>
            <button type="button" className="link ri-button primary" onClick={onConfirm}>
              PLAY HERE
            </button>
          </div>
        </div>
      )}
      {s.notice !== null && <div className={`flash${s.notice.tone === "good" ? " good" : ""}`}>{s.notice.text}</div>}
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

/** Not marked: the wizard's own words, terminal-styled; nothing reaches the story. */
function Refused({ program, ended, onClose }: { program: Program; ended: boolean; onClose: () => void }) {
  const copy = refusedCopy(program, ended);
  return (
    <div className="ri-card ri-refused" role="alert" onClick={onClose}>
      <div className="ri-card-icon" aria-hidden="true">
        {copy.icon}
      </div>
      <div className="ri-card-heading">{copy.heading}</div>
      <div className="ri-card-name">{program.name}</div>
      <div className="ri-card-text">{copy.status}</div>
      <div className="ri-card-why">⚠ {copy.why}</div>
    </div>
  );
}

/** The story's capture cue (`tablet_*`): a status line in the station's card
 *  (wave 26, T3: never a modal over the scanner) that names nobody (the
 *  capture is the guest's own news, on their phone). */
function WizardStatus() {
  return (
    <div className="ri-wizard" role="status">
      <div className="ri-wizard-icon" aria-hidden="true">
        💿
      </div>
      <div className="ri-wizard-words">
        <div className="ri-wizard-line">Setup is preparing to reinstall a program.</div>
        <div className="ri-wizard-sub">Corrupted program: scan your pass to begin.</div>
        <div className="ri-wizard-bar" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
