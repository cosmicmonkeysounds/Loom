//! The reinstallation device, screen by screen (`docs/loom-reinstall.md` §3):
//!
//!   setup    — provision this tablet (moderator passcode → token), name it,
//!              pick its role and camera. Once per device.
//!   scan     — the camera looking for a pass (the terminal's `Scanner`),
//!              the typed fallback, and the VR stations' status.
//!   choose   — a program was scanned: **Play here** or **Send to <station>**.
//!   sent     — parked for a headset: "put the headset on".
//!   play     — the simulation (`game/Play.tsx`), then back to scan.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Assignment, HouseMap, KingState, StationInfo } from "@loom/house";
import { matchName, parseScan } from "@loom/terminal/scan.ts";
import { Scanner, cameraProblem, type CameraState } from "@loom/terminal/scanner.tsx";
import { hasWebGL2 } from "@loom/terminal/webgl.ts";
import { ApiError, begin, fetchCandidates, fetchDealtHouse, fetchNightEnded, fetchStations, postEnd, tokenAlive } from "./api.ts";
import { applyHints, baseOf, dropConfig, hintsFromSearch, loadConfig, provision, saveConfig, withoutSecrets, type DeviceRole, type ReinstallConfig } from "./config.ts";
import { createSfx } from "./game/audio.ts";
import { findFlash } from "./game/hud.ts";
import { beginErrorText, markedLegend, NOT_MARKED, programPitch, programState, programStatus, quickPicks, startingHeading, type Program } from "./program.ts";
import { HOLD_MS, useLongPress } from "./kiosk.ts";
import { NO_WEBGL2, Play, type PlayExit } from "./game/Play.tsx";
import { showHouse } from "./show-house.ts";
import { Desktop, ProgressBar, Window, Wizard } from "./wizard.tsx";


type Screen =
  | { kind: "setup"; notice: string | null }
  | { kind: "scan" }
  | { kind: "choose"; program: Program }
  | { kind: "starting"; program: Program; label: string }
  | { kind: "sent"; program: Program; station: string }
  | { kind: "play"; assignment: Assignment; house: HouseMap; houseVersion: string; king?: KingState | null };

const STATION_POLL_MS = 2000;
/** The bundled map has a King (a `king` prop): the choose screen says what to do about him. */
const HAS_KING = showHouse.props.some((p) => p.kind === "king");

const SENT_BACK_MS = 9000;

export function App() {
  const [config, setConfig] = useState<ReinstallConfig | null>(() => loadConfig());
  const [screen, setScreen] = useState<Screen>(() => (loadConfig() ? { kind: "scan" } : { kind: "setup", notice: null }));
  const [flash, setFlash] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const sfx = useMemo(() => createSfx(), []);
  useEffect(() => () => sfx.dispose(), [sfx]);

  // Provision from the URL (`?code=…&name=…&role=…`), then scrub it.
  useEffect(() => {
    const hints = hintsFromSearch(window.location.search);
    const search = withoutSecrets(window.location.search);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}`);
    if (hints.code === "") {
      // A link without the passcode may still rename / re-role a set-up device.
      if (hints.name !== null || hints.role !== null || hints.camera !== null || hints.arrowsTurn !== null) {
        setConfig((c) => {
          if (c === null) return c;
          const next = applyHints(c, hints);
          saveConfig(next);
          return next;
        });
      }
      return;
    }
    void provision(hints.code, hints)
      .then((c) => {
        saveConfig(c);
        setConfig(c);
        setScreen({ kind: "scan" });
      })
      .catch((e: Error) => setScreen({ kind: "setup", notice: e.message }));
  }, []);

  // A stored token the run no longer honours sends the device back to setup.
  useEffect(() => {
    if (config === null) return;
    void tokenAlive(config).then((ok) => {
      if (!ok) {
        dropConfig();
        setConfig(null);
        setScreen({ kind: "setup", notice: "This device's access was revoked — enter the moderator passcode again." });
      }
    });
  }, [config]);

  useEffect(() => {
    if (flash === null) return;
    const t = window.setTimeout(() => setFlash(null), 7000);
    return () => window.clearTimeout(t);
  }, [flash]);

  if (config === null || screen.kind === "setup") {
    return (
      <Desktop>
        <Setup
          current={config}
          notice={screen.kind === "setup" ? screen.notice : null}
          onDone={(c) => {
            saveConfig(c);
            setConfig(c);
            setScreen({ kind: "scan" });
          }}
          onForget={() => {
            dropConfig();
            setConfig(null);
            setScreen({ kind: "setup", notice: "Forgotten." });
          }}
        />
      </Desktop>
    );
  }

  if (screen.kind === "play") {
    return (
      <Play
        config={config}
        assignment={screen.assignment}
        house={screen.house}
        houseVersion={screen.houseVersion}
        {...(screen.king !== undefined ? { king: screen.king } : {})}
        sfx={sfx}
        onExit={(e: PlayExit) => {
          setFlash(exitFlash(e));
          setScreen({ kind: "scan" });
        }}
      />
    );
  }

  return (
    <Device
      config={config}
      screen={screen}
      setScreen={setScreen}
      flash={flash}
      setFlash={setFlash}
      onPlay={() => sfx.resume()}
      onSetup={() => setScreen({ kind: "setup", notice: null })}
    />
  );
}

function exitFlash(e: PlayExit): { text: string; tone: "good" | "bad" } {
  switch (e.kind) {
    case "found":
      return findFlash(e.outcome, e.name);
    case "over":
      return { text: e.reason, tone: "bad" };
    case "idle":
      return { text: "Disconnected — nobody touched the controls for two minutes.", tone: "bad" };
    case "quit":
      return { text: "Simulation aborted.", tone: "bad" };
  }
}

// --- the running device ------------------------------------------------------

type DeviceScreen = Exclude<Screen, { kind: "setup" } | { kind: "play" }>;

function Device({
  config,
  screen,
  setScreen,
  flash,
  setFlash,
  onPlay,
  onSetup,
}: {
  config: ReinstallConfig;
  screen: DeviceScreen;
  setScreen: (s: Screen) => void;
  flash: { text: string; tone: "good" | "bad" } | null;
  setFlash: (f: { text: string; tone: "good" | "bad" } | null) => void;
  onPlay: () => void;
  onSetup: () => void;
}) {
  const stations = useStations(config, config.role !== "player");
  // After an ending the reinstallation is a party favour (S1).
  const ended = useNightEnded(config);
  // three.js needs WebGL2: never begin a session this browser can't play.
  const canDraw = useMemo(() => hasWebGL2(), []);
  const vr = stations.list.filter((s) => s.world === "vr");
  const online = vr.filter((s) => s.online).length;

  // A scanned id → the program (its name + whether it is corrupted).
  const identify = useCallback(
    async (id: string): Promise<Program | null> => {
      try {
        const found = (await fetchCandidates(config)).find((c) => c.id === id);
        return found ?? null;
      } catch (e) {
        setFlash({ text: e instanceof ApiError && e.status === 409 ? "The story isn't running yet." : `Lookup failed — ${(e as Error).message}`, tone: "bad" });
        return null;
      }
    },
    [config, setFlash],
  );

  const onCode = useCallback(
    (text: string) => {
      if (screen.kind !== "scan") return;
      const hit = parseScan(text);
      if (hit.kind === "wall") return setFlash({ text: "That's a wall code — show the program's pass.", tone: "bad" });
      if (hit.kind !== "guest") return setFlash({ text: "Unreadable — show the program's pass.", tone: "bad" });
      void identify(hit.id).then((p) => {
        if (p === null) setFlash({ text: "Unknown program — register on your phone first.", tone: "bad" });
        else {
          setFlash(null);
          setScreen({ kind: "choose", program: p });
        }
      });
    },
    [screen.kind, identify, setFlash, setScreen],
  );

  const playHere = async (p: Program) => {
    onPlay();
    setScreen({ kind: "starting", program: p, label: "Copying files…" });
    try {
      const assignment = await begin(config, p.id, "web");
      setScreen({ kind: "starting", program: p, label: "Building the simulation…" });
      // Only the map the server dealt on: the spawn and Gerald's spot are
      // placed on it (never the bundled stand-in, never another version).
      const loaded = await fetchDealtHouse(baseOf(config), assignment.token, assignment.houseVersion);
      if (loaded === null) {
        void postEnd(baseOf(config), assignment.token);
        setFlash({ text: "Couldn't load the house — scan the pass again.", tone: "bad" });
        setScreen({ kind: "scan" });
        return;
      }
      setScreen({ kind: "play", assignment, house: loaded.house, houseVersion: loaded.version, ...(loaded.king !== undefined ? { king: loaded.king } : {}) });
    } catch (e) {
      setFlash({ text: beginError(e), tone: "bad" });
      setScreen({ kind: "scan" });
    }
  };

  const sendTo = async (p: Program, s: StationInfo) => {
    setScreen({ kind: "starting", program: p, label: `Sending to ${s.name || s.id}…` });
    try {
      await begin(config, p.id, "vr", s.id);
      setScreen({ kind: "sent", program: p, station: s.name || s.id });
      stations.refresh();
    } catch (e) {
      setFlash({ text: beginError(e), tone: "bad" });
      setScreen({ kind: "scan" });
    }
  };

  // "Sent" goes back to the scanner by itself.
  useEffect(() => {
    if (screen.kind !== "sent") return;
    const t = window.setTimeout(() => setScreen({ kind: "scan" }), SENT_BACK_MS);
    return () => window.clearTimeout(t);
  }, [screen, setScreen]);

  const status = (
    <>
      <span className={`led${stations.ok ? " on" : ""}`} />
      {config.role === "player" ? config.name : `${online}/${vr.length} headset${vr.length === 1 ? "" : "s"} online`}
    </>
  );

  return (
    <Desktop status={status}>
      <Window title={`Reinstallation Wizard — ${config.name}`} className="main-window">
        {screen.kind === "scan" && (
          <ScanStep config={config} ended={ended} canDraw={canDraw} onCode={onCode} onPick={(p) => setScreen({ kind: "choose", program: p })} onProblem={(t) => setFlash({ text: t, tone: "bad" })} stations={vr} showStations={config.role !== "player"} onSetup={onSetup} />
        )}
        {screen.kind === "choose" && (
          <Wizard
            step={2}
            total={3}
            heading={programStatus(screen.program, ended).heading}
            actions={
              <>
                <button className="w98-button" onClick={() => setScreen({ kind: "scan" })}>
                  &lt; Back
                </button>
                <span className="spacer" />
                {config.role !== "station" && (
                  <button className="w98-button default big" onClick={() => void playHere(screen.program)} disabled={!canDraw || !screen.program.eligible} autoFocus={canDraw && screen.program.eligible}>
                    Play here &gt;
                  </button>
                )}
              </>
            }
          >
            <div className="program-card w98-sunken">
              <div className="program-icon" aria-hidden="true">
                {programStatus(screen.program, ended).icon}
              </div>
              <div>
                <div className="program-name">{screen.program.name}</div>
                <div className="program-meta">
                  {programStatus(screen.program, ended).status}
                  {screen.program.location !== null && <> · in {screen.program.location}</>}
                </div>
              </div>
            </div>
            <p className="program-pitch">{programPitch(programState(screen.program, ended))}</p>
            {HAS_KING && config.role !== "station" && programState(screen.program, ended) !== "favour" && (
              <p className="king-note">Find Gerald. In the simulation the King guards the Server Room's door: every program may hit him once per reinstallation, and every hit weakens him for everyone.</p>
            )}
            {!screen.program.eligible && (
              <div className="w98-error not-marked" role="alert">
                ⚠ {NOT_MARKED}
              </div>
            )}
            {!canDraw && config.role !== "station" && screen.program.eligible && <div className="w98-error">⚠ {NO_WEBGL2}</div>}
            {config.role !== "player" && (
              <fieldset className="w98-group">
                <legend>Send to a headset</legend>
                {vr.length === 0 && <div className="muted">No headsets have checked in.</div>}
                <div className="station-buttons">
                  {vr.map((s) => (
                    <button key={s.id} className="w98-button station" disabled={!screen.program.eligible || !s.online || s.busy !== null} onClick={() => void sendTo(screen.program, s)}>
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
        {screen.kind === "starting" && (
          <Wizard step={3} total={3} heading={startingHeading(programState(screen.program, ended), screen.program.name)}>
            <p>{screen.label}</p>
            <IndeterminateBar />
          </Wizard>
        )}
        {screen.kind === "sent" && (
          <Wizard
            step={3}
            total={3}
            heading={`Sent to ${screen.station}`}
            actions={
              <>
                <span className="spacer" />
                <button className="w98-button default big" onClick={() => setScreen({ kind: "scan" })} autoFocus>
                  OK
                </button>
              </>
            }
          >
            <p className="sent-big">
              <b>{screen.program.name}</b>: put the headset on.
            </p>
            <p>The simulation starts the moment the headset wakes. Use the thumbsticks: left walks, right turns.</p>
            <ProgressBar value={1} label="Transferred" />
          </Wizard>
        )}
      </Window>
      {flash !== null && <div className={`flash ${flash.tone}`}>{flash.text}</div>}
    </Desktop>
  );
}

function beginError(e: unknown): string {
  return beginErrorText(e instanceof ApiError ? e.status : null, (e as Error).message);
}

function IndeterminateBar() {
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

// --- stations ----------------------------------------------------------------

/** `night.ended` off the screen state, every `ENDED_POLL_MS` (false until it says so). */
const ENDED_POLL_MS = 15_000;
function useNightEnded(config: ReinstallConfig): boolean {
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

function useStations(config: ReinstallConfig, enabled: boolean): { list: StationInfo[]; ok: boolean; refresh: () => void } {
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

// --- scan ----------------------------------------------------------------------

/** A setup control that opens only after a 2 s hold, filling up while held
 *  (W-15). A tap or a click does nothing — the tent tablet is in guests' hands. */
function HoldButton({ onFire, label, children }: { onFire: () => void; label: string; children: ReactNode }) {
  const { holding, handlers } = useLongPress(onFire);
  return (
    <button
      type="button"
      className={`w98-button hold${holding ? " holding" : ""}`}
      style={{ ["--hold-ms" as string]: `${HOLD_MS}ms` }}
      aria-label={`${label} (hold for ${HOLD_MS / 1000} seconds)`}
      title={`Hold for ${HOLD_MS / 1000} seconds`}
      {...handlers}
    >
      {children}
    </button>
  );
}

function ScanStep({
  config,
  ended,
  canDraw,
  onCode,
  onPick,
  onProblem,
  stations,
  showStations,
  onSetup,
}: {
  config: ReinstallConfig;
  /** An ending has played: anyone may play (a party favour). */
  ended: boolean;
  /** This browser has WebGL2 (it can play here). */
  canDraw: boolean;
  onCode: (text: string) => void;
  onPick: (p: Program) => void;
  onProblem: (text: string) => void;
  stations: StationInfo[];
  showStations: boolean;
  onSetup: () => void;
}) {
  const [camera, setCamera] = useState<CameraState>("starting");
  const [typed, setTyped] = useState("");
  const [candidates, setCandidates] = useState<Program[]>([]);
  const [busy, setBusy] = useState(false);

  // The corrupted programs, offered as quick picks (and the typed roster).
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchCandidates(config)
        .then((c) => alive && setCandidates(c))
        .catch(() => {});
    load();
    const t = window.setInterval(load, 10_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [config]);
  const { corrupted, marked } = quickPicks(candidates, 8, ended);

  const submit = async () => {
    if (typed.trim() === "" || busy) return;
    setBusy(true);
    try {
      const roster = await fetchCandidates(config);
      setCandidates(roster);
      const hit = matchName(typed, roster);
      if (hit.kind === "one") {
        const p = roster.find((r) => r.id === hit.id);
        if (p !== undefined) onPick(p);
      } else if (hit.kind === "many") onProblem(`Several programs match: ${hit.names.slice(0, 4).join(", ")}`);
      else onProblem("No such program — register on your phone first.");
    } catch (e) {
      onProblem(e instanceof ApiError && e.status === 409 ? "The story isn't running yet." : `Lookup failed — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // The scanner names its own problem in the camera box; here, only point
  // at the fallback.
  const noCamera = cameraProblem(camera) !== null;
  return (
    <Wizard
      step={1}
      total={3}
      heading="Insert the program"
      actions={
        <>
          <HoldButton onFire={onSetup} label="Set up this device">
            ⚙ Setup…
          </HoldButton>
          <span className="spacer" />
          <HoldButton onFire={() => window.location.assign("map")} label="Open the house map">
            🗺 House map
          </HoldButton>
        </>
      }
    >
      <div className="scan-layout">
        <div className={`scan-camera w98-sunken${noCamera ? " off" : ""}`}>
          <Scanner facing={config.camera} active onCode={onCode} onState={setCamera} />
          {camera === "live" && <div className="scan-hint">hold the pass to the camera</div>}
        </div>
        <div className="scan-side">
          {!canDraw && config.role === "player" && <div className="w98-error">⚠ {NO_WEBGL2}</div>}
          <p>
            {!noCamera ? (
              <>
                Show the program's <b>pass</b> (the QR on their phone: menu → Your pass).
              </>
            ) : corrupted.length + marked.length > 0 ? (
              <>No camera here: tap the program below, or type their name.</>
            ) : (
              <>No camera here: type the program's name.</>
            )}
          </p>
          <form
            className="typed"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label htmlFor="typed-name">{noCamera ? "The program's name:" : "No camera? Type the program's name:"}</label>
            <div className="typed-row">
              <input id="typed-name" className="w98-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Winamp" autoComplete="off" autoCapitalize="off" spellCheck={false} />
              <button className="w98-button" type="submit" disabled={busy || typed.trim() === ""}>
                OK
              </button>
            </div>
          </form>
          {corrupted.length > 0 && (
            <fieldset className="w98-group">
              <legend>In the Internet now</legend>
              <div className="quick-picks">
                {corrupted.map((c) => (
                  <button key={c.id} className="w98-button pick" onClick={() => onPick(c)}>
                    ☣ {c.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {marked.length > 0 && (
            <fieldset className="w98-group">
              <legend>{markedLegend(ended)}</legend>
              <div className="quick-picks">
                {marked.map((c) => (
                  <button key={c.id} className="w98-button pick" onClick={() => onPick(c)}>
                    {ended ? "🎉" : "🚨"} {c.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {showStations && (
            <fieldset className="w98-group">
              <legend>Headsets</legend>
              {stations.length === 0 ? (
                <div className="muted">None have checked in.</div>
              ) : (
                <ul className="stations">
                  {stations.map((s) => (
                    <li key={s.id}>
                      <span className={`led${s.online ? " on" : ""}`} />
                      <b>{s.name || s.id}</b> <span className="muted">{!s.online ? "offline" : s.busy !== null ? `playing: ${s.busy.name}` : "ready"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}
        </div>
      </div>
    </Wizard>
  );
}

// --- setup -------------------------------------------------------------------

export function Setup({ current, notice, onDone, onForget }: { current: ReinstallConfig | null; notice: string | null; onDone: (c: ReinstallConfig) => void; onForget: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(current?.name ?? "");
  const [role, setRole] = useState<DeviceRole>(current?.role ?? "both");
  const [camera, setCamera] = useState<ReinstallConfig["camera"]>(current?.camera ?? "user");
  const [arrowsTurn, setArrowsTurn] = useState(current?.arrowsTurn ?? true);
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const hints = { name: name.trim() || null, role, camera, arrowsTurn };
      if (code.trim() !== "") onDone(await provision(code.trim(), hints));
      else if (current !== null) onDone(applyHints(current, hints));
      else {
        codeInput.current?.focus();
        throw new Error("Enter the moderator passcode.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Window title="Reinstallation Wizard — Setup" className="main-window">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Wizard
          heading="Welcome to the Reinstallation Wizard"
          actions={
            <>
              {current !== null && (
                <button type="button" className="w98-button" onClick={onForget}>
                  Forget device
                </button>
              )}
              <span className="spacer" />
              <button type="submit" className="w98-button default big" disabled={busy}>
                {busy ? "Connecting…" : "Next >"}
              </button>
            </>
          }
        >
          <p>This device reinstalls corrupted programs: scan a pass, and the program explores a virtual copy of the house to find Gerald, the golden duck — here, or on a VR headset.</p>
          {error && <div className="w98-error">⚠ {error}</div>}
          <label className="field">
            Moderator passcode {current !== null && <span className="muted">(blank keeps this device's access)</span>}
            <input ref={codeInput} className="w98-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={current !== null ? "••••••" : "from the Run page"} />
          </label>
          <label className="field">
            This device's name
            <input className="w98-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tent tablet" />
          </label>
          <fieldset className="w98-group">
            <legend>A scanned program…</legend>
            {(
              [
                ["both", "plays here, or is sent to a headset (you choose)"],
                ["player", "plays here, on this device"],
                ["station", "is sent to a VR headset"],
              ] as const
            ).map(([r, label]) => (
              <label key={r} className="radio">
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} /> {label}
              </label>
            ))}
          </fieldset>
          <div className="field-row">
            <label className="field">
              Camera
              <select className="w98-input" value={camera} onChange={(e) => setCamera(e.target.value as ReinstallConfig["camera"])}>
                <option value="user">front (facing the player)</option>
                <option value="environment">back</option>
              </select>
            </label>
            <label className="radio checkbox">
              <input type="checkbox" checked={arrowsTurn} onChange={(e) => setArrowsTurn(e.target.checked)} /> ← / → turn (else strafe)
            </label>
          </div>
          <p className="muted small">
            Provision by link: <code>/reinstall/?code=&lt;mod passcode&gt;&amp;name=Tent tablet&amp;role=both</code>. The house map editor is at <a href="map">/reinstall/map</a>.
          </p>
        </Wizard>
      </form>
    </Window>
  );
}
