//! The terminal, screen by screen:
//!
//!   setup      — provision this tablet (moderator passcode → token), name it,
//!                pick the character, camera and voice. Once per tablet.
//!   (screensaver) while the character is hidden or asleep (`screen.ts`
//!                polls `/api/screen/state` every 2 s — K-16): the Mystify
//!                screensaver + fake-1999 ads (`Attract.tsx`). No camera,
//!                no scanner, never "ONLINE", never a pilot. Fails closed:
//!                shown until the server first says otherwise.
//!   attract    — the face, waiting; the camera looking for a pass.
//!   connecting — a pass was scanned: minting the guest's session.
//!   piloting   — the direct line: the thread, the composer, the countdown.
//!
//! Beside the scanner, the attract screen's face pane becomes the **world
//! view** (`world/`) while a program is in the reinstallation simulation —
//! per the terminal's `view` (auto / world / face); while piloting it is
//! always the face, which is the voice. `view: mirror` is a different
//! terminal altogether: a full-screen spectator of the simulation — no
//! scanner, no line, nothing to say. `view: tv` (`Tv.tsx`, K-18) is the TV
//! over the fireplace: the face full screen, speaking the character's lines
//! in the TV's room, the world beside it while someone is in the simulation.
//!
//! Over all of it, the **screen layer** (`ScreenLayer.tsx` / `slides.ts` —
//! K-17 + N-03): the story's overlays, PNG slides, corner countdown and Y2K
//! clock, in the order overlay > slide (held 45 s here, 90 s on the TV; a
//! few persist) > attract > the base view. A pilot pre-empts a slide; an
//! overlay ends the pilot. The mirror honours attract too: the TV keeps
//! the screensaver until the character is introduced.
//!
//! The voice is the device's own (`speech/engine.ts`: speechSynthesis →
//! Fully Kiosk's TTS → text only); the server voice is an opt-in. A
//! terminal set to say the house announcements (`announce`, N-09) rings a
//! chime and says each new `do announce "…"` (`announce.ts`) after the
//! character's line in progress, with the words on a banner.
//!
//! A tap on the wake overlay (or anywhere on the page) is the one gesture the browser needs
//! before the terminal may make a sound unattended. The screen is held on
//! with a Wake Lock from boot (re-taken on that tap and whenever the page
//! comes back into view), and the ⚙ opens setup only on a 2 s hold
//! (`kiosk.ts`) — a guest's short tap does nothing.

import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Composer, Thread } from "./chat.tsx";
import { DEFAULT_TV_ROOM, baseOf, dropConfig, hintsFromSearch, loadConfig, provision, saveConfig, tvRoomOf, withoutSecrets, type TerminalConfig, type TerminalView } from "./config.ts";
import { Face, type FaceHandle } from "./face/Face.tsx";
import { moodOfText, type Mood } from "./face/mood.ts";
import { useIdleTimeout } from "./idle.ts";
import { beginPilot, endPilot, fetchRoster, tokenAlive, usePilotSession, type Line, type Pilot } from "./pilot.ts";
import { matchName, parseScan } from "./scan.ts";
import { Scanner, type CameraState, cameraProblem } from "./scanner.tsx";
import { BrowserEngine, DeviceEngine, ENGINE_LABEL, SpeechQueue, audioUnlocked, deviceEnv, pickDeviceEngine, unlock, voiceEngines, voiceNote, type EngineKind, type VoiceChoice } from "./speech/engine.ts";
import { ringChime, useAnnouncements } from "./announce.ts";
import { CHARACTER_VOICE, rankVoices } from "./speech/pick-voice.ts";
import { revealOffsets, splitSentences } from "./speech/split.ts";
import { mayReload, retryable } from "./retry.ts";
import { bundledHouse, fetchHouse, useSpatialStream, useWorld, type Gone, type HouseInfo, type WorldStore } from "./world/stream.ts";
import { effectiveView, hasWebGL2 } from "./webgl.ts";
import { HOLD_MS, screenWake, useLongPress } from "./kiosk.ts";
import { attractOf, useScreenState } from "./screen.ts";
import { Attract } from "./Attract.tsx";
import { LiveScreenLayer } from "./ScreenLayer.tsx";
import { Tv } from "./Tv.tsx";
import { screenLayers } from "./slides.ts";

// three.js is most of the weight of the world view — a face-only terminal
// never loads it. Retryable: `lazy` alone caches a failed load forever.
const loadWorld = retryable(() => import("./world/WorldView.tsx").then((m) => ({ default: m.WorldView })));

type Screen = { kind: "setup"; notice: string | null } | { kind: "attract" } | { kind: "connecting"; id: string } | { kind: "piloting"; pilot: Pilot };

export function App() {
  const [config, setConfig] = useState<TerminalConfig | null>(() => loadConfig());
  const [screen, setScreen] = useState<Screen>(() => (loadConfig() ? { kind: "attract" } : { kind: "setup", notice: null }));
  const [awake, setAwake] = useState(() => audioUnlocked());
  // The lean screen state, polled every 2 s (also this terminal's heartbeat).
  // The TV also asks for its room's new lines after its chat cursor (K-18).
  const tvCursor = useRef<number | null>(null);
  useEffect(() => {
    tvCursor.current = null; // a new config starts at the room's head: no backlog
  }, [config]);
  const screenState = useScreenState(config, config?.view === "tv" ? () => ({ room: tvRoomOf(config), after: tvCursor.current }) : null);
  // The house announcements (N-09), when this screen is set to say them.
  const announcement = useAnnouncements(config, screenState.state);

  // Fetch the world view's code at boot, while this page and the server are
  // known to match — hours later a rebuild may have renamed the chunk. Not
  // on a tablet that can't draw it (no WebGL2 → face only, see `webgl.ts`).
  const webgl2 = hasWebGL2();
  const view = config?.view;
  useEffect(() => {
    if (webgl2 && view !== undefined && view !== "face") void loadWorld().catch(() => {});
  }, [view, webgl2]);

  // Provision from the URL (`?code=…&name=…`) — a fleet is set up by opening one link each.
  useEffect(() => {
    const hints = hintsFromSearch(window.location.search);
    if (hints.code === "") return;
    window.history.replaceState(null, "", `${window.location.pathname}${withoutSecrets(window.location.search)}`);
    void provision(hints.code, hints)
      .then((c) => {
        saveConfig(c);
        setConfig(c);
        setScreen({ kind: "attract" });
      })
      .catch((e: Error) => setScreen({ kind: "setup", notice: e.message }));
  }, []);

  // A stored token the run no longer honours (the codes were rotated) sends
  // the terminal back to setup rather than failing every scan.
  useEffect(() => {
    if (config === null) return;
    void tokenAlive(config).then((ok) => {
      if (!ok) {
        dropConfig();
        setConfig(null);
        setScreen({ kind: "setup", notice: "This terminal's access was revoked — enter the moderator passcode again." });
      }
    });
  }, [config]);

  // The poll was refused: the token no longer works for this run.
  useEffect(() => {
    if (!screenState.revoked) return;
    dropConfig();
    setConfig(null);
    setScreen({ kind: "setup", notice: "This terminal's access was revoked — enter the moderator passcode again." });
  }, [screenState.revoked]);

  // The poll's event is gone (ended; a new one launched): back to setup, the
  // config kept so its name / character / spot carry over — like `onGone`.
  useEffect(() => {
    if (!screenState.ended) return;
    setScreen({ kind: "setup", notice: "The event this terminal was part of has ended — enter the moderator passcode of the next one." });
  }, [screenState.ended]);

  // Keep the screen on from boot: Chrome grants a wake lock to a visible
  // page without a gesture; `ScreenWake` re-takes it on every return to view.
  useEffect(() => {
    void screenWake().keepOn();
  }, []);

  const wake = useCallback(() => {
    void screenWake().keepOn();
    void unlock().then(() => setAwake(audioUnlocked() || !("AudioContext" in window)));
  }, []);

  // Any touch counts as the wake gesture, not only the TOUCH TO WAKE button:
  // a slide (z-index above it) can cover the button on a tablet that rebooted
  // mid-show. Capture phase, so the tap still does whatever it landed on.
  useEffect(() => {
    if (awake) return;
    const onDown = () => wake();
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [awake, wake]);

  // The spatial stream was refused for good: access revoked, or the event over.
  const onGone = useCallback((g: Gone) => {
    if (g === "revoked") {
      dropConfig();
      setConfig(null);
      setScreen({ kind: "setup", notice: "This terminal's access was revoked — enter the moderator passcode again." });
    } else {
      // Kept, so its name / character / spot carry over to the next event.
      setScreen({ kind: "setup", notice: "The event this terminal was part of has ended — enter the moderator passcode of the next one." });
    }
  }, []);

  const finish = useCallback((c: TerminalConfig) => {
    saveConfig(c);
    setConfig(c);
    setScreen({ kind: "attract" });
  }, []);

  if (config === null || screen.kind === "setup") {
    return (
      <Setup
        current={config}
        notice={screen.kind === "setup" ? screen.notice : null}
        onDone={(c) => {
          wake();
          finish(c);
        }}
        onForget={() => {
          dropConfig();
          setConfig(null);
          setScreen({ kind: "setup", notice: "Forgotten." });
        }}
      />
    );
  }

  const openSetup = () => setScreen({ kind: "setup", notice: null });
  const piloting = screen.kind === "piloting" || screen.kind === "connecting";
  // An overlay (blackout / go to the living room / alarm) ends any pilot.
  const takeover = screenLayers(screenState.state, Date.now(), { piloting }).overlay !== null;
  const layer = (
    <>
      <LiveScreenLayer state={screenState.state} piloting={piloting} gear={<Gear onOpen={openSetup} label="Set up this terminal" className="mirror-gear" />} />
      {announcement !== null && (
        <div className="announce-banner" role="status">
          <span className="announce-icon" aria-hidden="true">
            📢
          </span>
          {announcement}
        </div>
      )}
    </>
  );
  const attractScreen = (
    <Attract
      corner={
        <>
          <div className="mirror-corner">
            {config.title ? `${config.title} · ` : ""}
            {config.name.toUpperCase()}
          </div>
          <Gear onOpen={openSetup} label="Set up this terminal" className="mirror-gear" />
        </>
      }
    />
  );

  if (config.view === "tv") {
    return (
      <>
        <Tv
          config={config}
          state={screenState.state}
          cursor={tvCursor}
          attract={attractOf(screenState.state)}
          attractScreen={attractScreen}
          canDraw={webgl2}
          worldSlot={(store) => <WorldSlot store={store} spotId={config.spot} size="full" recover="reload" />}
          gear={<Gear onOpen={openSetup} label="Set up this screen" className="mirror-gear" />}
          onGone={onGone}
        />
        {layer}
      </>
    );
  }

  if (config.view === "mirror") {
    return (
      <>
        {attractOf(screenState.state) ? attractScreen : <Mirror config={config} canDraw={webgl2} onSetup={openSetup} onGone={onGone} />}
        {layer}
      </>
    );
  }

  const wakeOverlay = !awake && (
    <button className="wake" onClick={wake}>
      <span className="wake-title">TOUCH TO WAKE</span>
      <span className="wake-sub">this terminal needs one touch before it may speak</span>
    </button>
  );

  // The character is hidden or asleep: the screensaver, unless a line is
  // already open (a pilot ends on its own leash, then attract takes over).
  if (attractOf(screenState.state) && screen.kind !== "piloting") {
    return (
      <>
        {attractScreen}
        {wakeOverlay}
        {layer}
      </>
    );
  }

  return (
    <>
      <Terminal
        config={config}
        screen={screen}
        setScreen={setScreen}
        castOnline={!screenState.reachable || screenState.state?.character?.hold === true ? null : (screenState.state?.character?.online ?? null)}
        polled={screenState.reachable}
        takeover={takeover}
        onSetup={openSetup}
        onGone={onGone}
      />
      {wakeOverlay}
      {layer}
    </>
  );
}

// --- the world view, guarded -------------------------------------------------

/** After the world view failed to load (or draw), try again this much later (ms). */
const WORLD_RETRY_MS = 30_000;
/** A mirror reloads the page at most this often (ms). */
const RELOAD_GAP_MS = 5 * 60_000;
const RELOAD_KEY = "loom-terminal:world-reload";

function lastReload(): number | null {
  try {
    const v = Number(sessionStorage.getItem(RELOAD_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function noteReload(at: number): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(at));
  } catch {
    /* no storage: the gap check just can't hold */
  }
}

/** Catches a failed world view so the rest of the terminal (scanner, line) keeps running. */
class WorldBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    this.props.onError();
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The world view behind an error boundary. A failure falls back (a pane: to
 * the face underneath; full screen: a notice) and recovers `WORLD_RETRY_MS`
 * later — `retry` loads the chunk again in place, `reload` (a mirror, which
 * needs no wake gesture) reloads the page so a stale bundle picks up the new
 * chunk names, when the page is reachable and it hasn't just done so.
 */
function WorldSlot({ store, spotId, size, recover }: { store: WorldStore; spotId: string; size: "pane" | "full"; recover: "retry" | "reload" }) {
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  // A fresh `lazy` per attempt: React caches each one's settled payload.
  const View = useMemo(() => lazy(loadWorld), [attempt]);
  useEffect(() => {
    if (!broken) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void (async () => {
        if (recover === "reload") {
          const reachable = await fetch(window.location.href, { cache: "no-store" }).then(
            (r) => r.ok,
            () => false,
          );
          if (!alive) return;
          const now = Date.now();
          if (mayReload(reachable, lastReload(), now, RELOAD_GAP_MS)) {
            noteReload(now);
            window.location.reload();
            return;
          }
        }
        if (!alive) return;
        setBroken(false);
        setAttempt((a) => a + 1);
      })();
    }, WORLD_RETRY_MS);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [broken, recover]);
  const full = size === "full";
  return (
    <WorldBoundary key={attempt} fallback={full ? <div className="world-note blink">SIMULATION UNAVAILABLE — RETRYING…</div> : null} onError={() => setBroken(true)}>
      <Suspense fallback={full ? <div className="world-note blink">LOADING THE SIMULATION…</div> : null}>
        <View store={store} spotId={spotId} size={size} />
      </Suspense>
    </WorldBoundary>
  );
}

/** Report the spatial stream's `gone` (once per value). */
function useGone(world: WorldStore, onGone: (g: Gone) => void): void {
  const gone = useWorld(world, (s) => s.gone);
  useEffect(() => {
    if (gone !== null) onGone(gone);
  }, [gone, onGone]);
}

// --- the running terminal ----------------------------------------------------

function Terminal({
  config,
  screen,
  setScreen,
  castOnline,
  polled,
  takeover,
  onSetup,
  onGone,
}: {
  config: TerminalConfig;
  screen: Screen;
  setScreen: (s: Screen) => void;
  /** Is the character's agent online? (from the screen-state poll; null =
   *  unknown, or a `hold:` character that always answers) */
  castOnline: boolean | null;
  /** The screen-state poll is answering (the bar's connection dot). */
  polled: boolean;
  /** A story overlay covers the screen: no scanning, and an open line ends. */
  takeover: boolean;
  onSetup: () => void;
  onGone: (g: Gone) => void;
}) {
  const pilot = screen.kind === "piloting" ? screen.pilot : null;
  const session = usePilotSession(config, pilot);
  const [mood, setMood] = useState<Mood>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [flash, setFlash] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [typedOpen, setTypedOpen] = useState(false);
  const [engineUsed, setEngineUsed] = useState<EngineKind | null>(null);
  const [latched, setLatched] = useState(false);
  const face = useRef<FaceHandle | null>(null);
  const offsets = useRef(new Map<number, number[]>());
  const chunkText = useRef(new Map<number, string[]>());

  // --- the reinstallation simulation, beside the scanner ---
  const view = effectiveView(config.view, hasWebGL2());
  const world = useSpatialStream(config, view !== "face");
  const inSimulation = useWorld(world, (s) => s.world.players.size > 0);
  useGone(world, onGone);
  const showWorld = screen.kind === "attract" && (view === "world" || (view === "auto" && inSimulation));

  // --- the voice ---
  const queue = useMemo(() => {
    const engines = voiceEngines(
      { choice: config.engine, browserVoice: config.browserVoice, serverVoice: config.serverVoice, speed: config.speed, base: baseOf(config), token: config.token },
      () => setLatched(true),
    );
    return new SpeechQueue(engines, {
      level: (v) => face.current?.level(v),
      chunk: (id, i) => {
        const text = chunkText.current.get(id)?.[i] ?? "";
        setMood(moodOfText(text));
        setSpeaking(true);
        const off = offsets.current.get(id)?.[i];
        if (off !== undefined) setRevealed((prev) => new Map(prev).set(id, off));
      },
      done: (id) => {
        offsets.current.delete(id);
        chunkText.current.delete(id);
        setRevealed((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      },
      idle: () => {
        setSpeaking(false);
        setMood("neutral");
      },
      engine: (kind) => setEngineUsed(kind),
    });
  }, [config]);
  useEffect(() => {
    setLatched(false); // a new voice (setup changed) asks the server afresh
    return () => queue.stop();
  }, [queue]);

  // Each new line of the character's is spoken — and revealed as it is said.
  // Subscribed once per queue (`onNewLine` is stable; the session object is
  // not) — a listener per render would say every reply several times over.
  const { onNewLine } = session;
  useEffect(
    () =>
      onNewLine((line: Line) => {
        const chunks = splitSentences(line.text);
        if (chunks.length === 0) return;
        offsets.current.set(line.seq, revealOffsets(line.text, chunks));
        chunkText.current.set(line.seq, chunks);
        setRevealed((prev) => new Map(prev).set(line.seq, 0));
        queue.say({ id: line.seq, chunks });
      }),
    [onNewLine, queue],
  );

  // --- the leash ---
  const end = useCallback(
    (why: "timeout" | "dead" | "left") => {
      if (pilot === null) return;
      queue.stop();
      setSpeaking(false);
      setRevealed(new Map());
      setMood("glitch");
      window.setTimeout(() => setMood("idle"), 1200);
      setScreen({ kind: "attract" });
      if (why === "timeout") setFlash(`${pilot.name.toUpperCase()} DISCONNECTED — NO INPUT`);
      else if (why === "dead") setFlash("CONNECTION LOST — THE SYSTEM RESTARTED");
      void endPilot(config, pilot);
    },
    [pilot, queue, config, setScreen],
  );
  const busy = session.typing || speaking || queue.busy;
  const { touch, warning, remaining } = useIdleTimeout({ active: pilot !== null, busy, onTimeout: () => end("timeout") });
  useEffect(() => {
    if (session.dead !== null && pilot !== null) end("dead");
  }, [session.dead, pilot, end]);
  useEffect(() => {
    if (takeover && pilot !== null) end("left");
  }, [takeover, pilot, end]);

  // Mood follows the situation when nothing is being said.
  useEffect(() => {
    if (speaking) return;
    if (screen.kind === "attract") setMood((m) => (m === "glitch" ? m : "idle"));
    else if (screen.kind === "connecting") setMood("attentive");
    else if (session.typing) setMood("thinking");
  }, [screen.kind, session.typing, speaking]);

  // Any touch anywhere feeds the leash.
  useEffect(() => {
    if (pilot === null) return;
    const on = () => touch();
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [pilot, touch]);

  // The flash message clears itself.
  useEffect(() => {
    if (flash === null) return;
    const t = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(t);
  }, [flash]);

  // --- connecting a scanned pass ---
  const connect = useCallback(
    async (guestId: string) => {
      if (screen.kind !== "attract") return;
      setScreen({ kind: "connecting", id: guestId });
      setMood("attentive");
      try {
        const p = await beginPilot(config, guestId);
        setScreen({ kind: "piloting", pilot: p });
        setFlash(null);
      } catch (e) {
        const msg = (e as Error).message;
        setFlash(/unknown guest/i.test(msg) ? "UNKNOWN PROGRAM — REGISTER ON YOUR PHONE FIRST" : /moderators only/i.test(msg) ? "THIS TERMINAL LOST ITS ACCESS" : `CONNECTION FAILED — ${msg.toUpperCase()}`);
        setMood("glitch");
        window.setTimeout(() => setMood("idle"), 1200);
        setScreen({ kind: "attract" });
      }
    },
    [config, screen.kind, setScreen],
  );
  const onCode = useCallback(
    (text: string) => {
      const hit = parseScan(text);
      if (hit.kind === "guest") void connect(hit.id);
      else if (hit.kind === "wall") setFlash("THAT'S A WALL CODE — SHOW ME YOUR PASS");
      else setFlash("UNREADABLE — SHOW ME YOUR PASS");
    },
    [connect],
  );

  const online = pilot !== null ? session.online : castOnline;
  const status = online === null ? "" : online ? `${config.character.toUpperCase()} ONLINE` : `${config.character.toUpperCase()} AWAY — REPLIES WHEN BACK`;

  return (
    <div className={`terminal ${screen.kind}${warning !== null ? " warning" : ""}`} data-leash={remaining ?? undefined} data-busy={pilot !== null ? String(busy) : undefined}>
      <header className="bar">
        <span className="bar-left">
          <span className="dot" data-on={String(pilot !== null ? session.connected : polled)} />
          {config.title ? `${config.title} · ` : ""}TERMINAL {config.name.toUpperCase()}
        </span>
        <span className="bar-mid">{status}</span>
        <span className="bar-right">
          {pilot !== null && <span className="pilot">PILOT: {pilot.name.toUpperCase()}</span>}
          {pilot !== null && warning !== null && <span className="countdown">{warning}</span>}
          {pilot !== null && (
            <button className="link" onClick={() => end("left")}>
              DISCONNECT
            </button>
          )}
          {pilot === null && (
            <Gear onOpen={onSetup} label="Set up this terminal" />
          )}
        </span>
      </header>

      <main className="stage">
        <section className={`face-pane${showWorld ? " showing-world" : ""}`}>
          {/* The face stays mounted under the world view: it holds the speech
              queue's level handle and its own easing state. */}
          <Face mood={mood} speaking={speaking} handle={face} />
          <div className="nameplate">{config.character.toUpperCase()}</div>
          {voiceNote(config.engine, engineUsed, latched) !== null && <div className="engine-note">{voiceNote(config.engine, engineUsed, latched)}</div>}
          {showWorld && <WorldSlot store={world} spotId={config.spot} size="pane" recover="retry" />}
        </section>

        <section className="line-pane">
          {screen.kind === "attract" && (
            <div className="attract">
              <div className="scan-frame">
                <Scanner facing={config.camera} active={!takeover} onCode={onCode} onState={setCamera} />
              </div>
              <div className="attract-text">
                <div className="big">SCAN YOUR PASS</div>
                <div className="small">open the app · tap ☰ · hold your pass to the camera</div>
                {cameraProblem(camera) !== null && <div className="small problem">{cameraProblem(camera)}</div>}
                <button className="link typed-link" onClick={() => setTypedOpen((o) => !o)}>
                  no camera? type your program name
                </button>
                {typedOpen && (
                  <TypedFallback
                    config={config}
                    onPick={(id) => {
                      setTypedOpen(false);
                      void connect(id);
                    }}
                    onProblem={setFlash}
                  />
                )}
              </div>
            </div>
          )}
          {screen.kind === "connecting" && (
            <div className="attract">
              <div className="big blink">CONNECTING…</div>
            </div>
          )}
          {screen.kind === "piloting" && pilot !== null && (
            <>
              <Thread lines={session.lines} revealed={revealed} typing={session.typing} character={config.character} guestName={pilot.name} />
              <Composer
                onSend={async (t) => {
                  touch();
                  await session.say(t);
                }}
                disabled={!session.ready}
                onInput={touch}
                placeholder={session.ready ? `say something to ${config.character}` : "connecting…"}
              />
            </>
          )}
        </section>
      </main>

      {flash !== null && <div className="flash">{flash}</div>}
      {warning !== null && pilot !== null && <div className="leash">DISCONNECTING IN {warning} — TOUCH TO STAY</div>}
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

// --- the typed fallback ------------------------------------------------------

function TypedFallback({ config, onPick, onProblem }: { config: TerminalConfig; onPick: (id: string) => void; onProblem: (msg: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    try {
      const hit = matchName(name, await fetchRoster(config));
      if (hit.kind === "one") onPick(hit.id);
      else if (hit.kind === "many") onProblem(`SEVERAL PROGRAMS MATCH: ${hit.names.slice(0, 4).join(", ").toUpperCase()}`);
      else onProblem("NO SUCH PROGRAM — REGISTER ON YOUR PHONE FIRST");
    } catch (e) {
      onProblem(`LOOKUP FAILED — ${(e as Error).message.toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="typed"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="your program name" autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} />
      <button type="submit" disabled={busy || name.trim() === ""}>
        CONNECT
      </button>
    </form>
  );
}

// --- the mirror ----------------------------------------------------------------

/** `view: mirror` — the simulation full screen, for a TV: nothing to scan,
 *  nothing to say (so no wake gesture is needed), only the gear. A screen
 *  with no WebGL2 (`canDraw` false) says so, still — no retry loop. */
function Mirror({ config, canDraw, onSetup, onGone }: { config: TerminalConfig; canDraw: boolean; onSetup: () => void; onGone: (g: Gone) => void }) {
  const world = useSpatialStream(config, canDraw);
  const connected = useWorld(world, (s) => s.connected);
  useGone(world, onGone);
  return (
    <div className="terminal mirror">
      {canDraw ? (
        <WorldSlot store={world} spotId={config.spot} size="full" recover="reload" />
      ) : (
        <div className="world-note">THIS SCREEN CAN'T DRAW THE SIMULATION (NO WEBGL2) — SET IT TO FACE ONLY</div>
      )}
      <div className="mirror-corner">
        <span className="dot" data-on={String(connected)} />
        {config.title ? `${config.title} · ` : ""}
        {config.name.toUpperCase()}
      </div>
      <Gear onOpen={onSetup} label="Set up this screen" className="mirror-gear" />
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

// --- the gear ------------------------------------------------------------------

/** The ⚙: opens setup only after a 2 s hold, filling up while held. A short
 *  tap (or a click) does nothing — a wall tablet is in guests' hands. */
function Gear({ onOpen, label, className }: { onOpen: () => void; label: string; className?: string }) {
  const { holding, handlers } = useLongPress(onOpen);
  return (
    <button
      type="button"
      className={`link gear${className ? ` ${className}` : ""}${holding ? " holding" : ""}`}
      style={{ ["--hold-ms" as string]: `${HOLD_MS}ms` }}
      aria-label={`${label} (hold for ${HOLD_MS / 1000} seconds)`}
      {...handlers}
    >
      ⚙
    </button>
  );
}

// --- setup -------------------------------------------------------------------

function Setup({ current, notice, onDone, onForget }: { current: TerminalConfig | null; notice: string | null; onDone: (c: TerminalConfig) => void; onForget: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(current?.name ?? "");
  const [character, setCharacter] = useState(current?.character ?? "Trabolta");
  const [camera, setCamera] = useState<TerminalConfig["camera"]>(current?.camera ?? "user");
  const [engine, setEngine] = useState<VoiceChoice>(current?.engine ?? "browser");
  const [announce, setAnnounce] = useState(current?.announce ?? false);
  const [tested, setTested] = useState<string | null>(null);
  const [serverVoice, setServerVoice] = useState(current?.serverVoice ?? "");
  const [browserVoice, setBrowserVoice] = useState(current?.browserVoice ?? "");
  const [speed, setSpeed] = useState(current?.speed ?? 1);
  const [spot, setSpot] = useState(current?.spot ?? "");
  const [view, setView] = useState<TerminalView>(current?.view ?? "auto");
  const [room, setRoom] = useState(current?.room ?? "");
  const [map, setMap] = useState<HouseInfo | null>(() => bundledHouse());
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [serverVoiceInfo, setServerVoiceInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!BrowserEngine.available()) return;
    const load = () => setVoices(rankVoices(speechSynthesis.getVoices(), CHARACTER_VOICE));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  // Only asked when the (opt-in) server voice is chosen.
  useEffect(() => {
    if (current === null || engine !== "server") return;
    void fetch(`${baseOf(current)}/api/mod/tts`, { headers: { "x-loom-token": current.token } })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { available: boolean; voice: string; model: string } | null) => {
        if (info === null) return;
        setServerVoiceInfo(info.available ? `server voice on (${info.model}, default ${info.voice})` : "the server has no voice (LOOM_TTS_URL is off) — this device's own will be used");
      })
      .catch(() => {});
  }, [current, engine]);
  const env = deviceEnv();
  const native = pickDeviceEngine(env);
  const deviceVoice =
    native === "browser"
      ? `this device has ${voices.length || env.voices} voice${(voices.length || env.voices) === 1 ? "" : "s"}`
      : native === "fully"
        ? "no browser voices — Fully Kiosk's text-to-speech will speak"
        : env.speech
          ? "no voices loaded on this device yet — text only until one appears (in Fully Kiosk: enable its JavaScript Interface)"
          : "this browser has no voice — text only (in Fully Kiosk: enable its JavaScript Interface)";

  // Where this screen can hang: the event's house map when this terminal can
  // read it, else the show's map baked into the build.
  useEffect(() => {
    if (current === null) return;
    let alive = true;
    void fetchHouse(current)
      .then((h) => alive && setMap(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current]);
  const spots = useMemo(
    () =>
      (map?.house.terminals ?? []).map((t) => ({
        id: t.id,
        label: `${t.name} — ${map?.house.rooms.find((r) => r.id === t.room)?.label ?? t.room}`,
      })),
    [map],
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let next: TerminalConfig;
      if (code.trim() !== "") {
        next = await provision(code.trim(), { name: name.trim() || null, character: character.trim() || null, camera, engine, spot, view, room: room.trim() || null, announce });
      } else if (current !== null) {
        next = { ...current, name: name.trim() || current.name, character: character.trim() || current.character, camera, engine, spot, view, room: room.trim(), announce };
      } else {
        throw new Error("Enter the moderator passcode.");
      }
      onDone({ ...next, serverVoice: serverVoice.trim(), browserVoice, speed });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Says a line through exactly the voice this terminal will use (the
  // server one when chosen, latching to the device's), and names it.
  const testVoice = async () => {
    await unlock();
    setTested("…");
    const engines =
      engine === "server" && current !== null
        ? voiceEngines({ choice: "server", browserVoice, serverVoice: serverVoice.trim(), speed, base: baseOf(current), token: current.token })
        : { primary: new DeviceEngine({ voice: browserVoice, speed, choice: engine === "server" ? "browser" : engine, prefer: CHARACTER_VOICE }), fallback: null };
    let used: EngineKind | null = null;
    const q = new SpeechQueue(engines, {
      level: () => {},
      chunk: () => {},
      done: () => {},
      idle: () => setTested(used === null ? "nothing could speak" : `spoke with: ${ENGINE_LABEL[used]}`),
      engine: (k) => (used = k),
    });
    q.say({ id: 1, chunks: ["Connection established.", "I have been expecting you, program."] });
  };
  const testChime = async () => {
    await unlock();
    await ringChime();
  };

  return (
    <div className="terminal setup-screen">
      <form
        className="setup"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1>TERMINAL SETUP</h1>
        <p className="muted">One tablet, one line. Enter the event's moderator passcode once; this screen then pilots any pass held up to its camera.</p>
        {error && <div className="error">{error}</div>}
        <label>
          moderator passcode {current !== null && <span className="muted">(leave blank to keep this terminal's access)</span>}
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={current !== null ? "••••••" : "from the server's boot banner / Run page"} />
        </label>
        <label>
          this terminal's name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kitchen" />
        </label>
        <label>
          character (an agent-voiced one)
          <input value={character} onChange={(e) => setCharacter(e.target.value)} placeholder="Trabolta" />
        </label>
        <div className="row">
          <label>
            camera
            <select value={camera} onChange={(e) => setCamera(e.target.value as TerminalConfig["camera"])}>
              <option value="user">front (facing the room)</option>
              <option value="environment">back</option>
            </select>
          </label>
          <label>
            voice
            <select value={engine} onChange={(e) => setEngine(e.target.value as VoiceChoice)}>
              <option value="browser">this device's own voice (recommended)</option>
              <option value="fully">Fully Kiosk's voice (Android TTS)</option>
              <option value="silent">no voice — text only</option>
              <option value="server">the server's voice (needs LOOM_TTS_URL)</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            where it hangs <span className="muted">(its spot in the house map)</span>
            <select value={spot} onChange={(e) => setSpot(e.target.value)}>
              <option value="">unplaced — never a window</option>
              {spots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              {spot !== "" && !spots.some((s) => s.id === spot) && <option value={spot}>{spot} (not in the map)</option>}
            </select>
          </label>
          <label>
            screen
            <select value={view} onChange={(e) => setView(e.target.value as TerminalView)}>
              <option value="auto">face — the simulation while someone plays</option>
              <option value="world">the simulation, always (face while piloting)</option>
              <option value="face">face only</option>
              <option value="mirror">mirror — full-screen simulation, no scanner</option>
              <option value="tv">TV — the face speaks the room's lines, no scanner</option>
            </select>
          </label>
        </div>
        {view === "tv" && (
          <label>
            the room it speaks for <span className="muted">(a LOCATION; blank = {DEFAULT_TV_ROOM})</span>
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder={DEFAULT_TV_ROOM} />
          </label>
        )}
        {!hasWebGL2() && view !== "face" && <div className="muted small">this tablet has no WebGL2 — it can't draw the simulation, so it will show the face</div>}
        {map !== null && map.source === "bundled" && current !== null && <div className="muted small">couldn't read the event's house map — listing the show's own spots</div>}
        <div className="muted small">{deviceVoice}</div>
        {engine === "server" && serverVoiceInfo && <div className="muted">{serverVoiceInfo}</div>}
        <div className="row">
          {engine === "server" && (
            <label>
              server voice name <span className="muted">(blank = server default)</span>
              <input value={serverVoice} onChange={(e) => setServerVoice(e.target.value)} placeholder="am_michael · bm_george · af_bella+af_sky" />
            </label>
          )}
          <label>
            pace {speed.toFixed(2)}×
            <input type="range" min={0.6} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
        </div>
        <label>
          device voice <span className="muted">({character.trim() || "the character"}'s — best first, male first; announcements take a different one)</span>
          <span className="row">
            <select value={browserVoice} onChange={(e) => setBrowserVoice(e.target.value)} disabled={voices.length === 0}>
              <option value="">{voices[0] ? `best available — ${voices[0].name}` : "the device's default"}</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang}){v.localService ? "" : " · online"}
                </option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={() => void testVoice()}>
              TEST VOICE
            </button>
          </span>
        </label>
        {tested !== null && <div className="muted small">{tested}</div>}
        <label className="check">
          <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
          say the house announcements here <span className="muted">(a chime + "Go to the living room." — off where the house speakers reach)</span>
          <button type="button" className="ghost" onClick={() => void testChime()}>
            CHIME
          </button>
        </label>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? "CONNECTING…" : "POWER ON"}
          </button>
          {current !== null && (
            <button type="button" className="ghost" onClick={onForget}>
              forget this terminal
            </button>
          )}
        </div>
        <p className="muted small">
          Provision a fleet by opening <code>/terminal/?code=&lt;mod passcode&gt;&amp;name=Kitchen&amp;character=Trabolta&amp;spot=kitchen&amp;view=auto</code> on each tablet (add <code>&amp;announce=1</code> where the house speakers don't reach). The camera needs https:// (or localhost); without it, programs type their name instead.
        </p>
      </form>
    </div>
  );
}
