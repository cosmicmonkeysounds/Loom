//! The terminal, screen by screen:
//!
//!   setup      — provision this tablet (moderator passcode → token), name it,
//!                pick the character, camera and voice. Once per tablet.
//!   (screensaver) while the character is hidden or asleep (`screen.ts`
//!                polls `/api/screen/state` every 2 s — K-16): the idle
//!                show full screen (`Attract.tsx`, `idle-show/` — wave 17:
//!                screensavers, fake-1999 ads, popups), never naming him.
//!                No camera, no scanner, never "ONLINE", never a pilot.
//!                Fails closed: shown until the server first says otherwise.
//!   attract    — the idle show again, now free to name him, with the
//!                camera in the corner's scan box looking for a pass (D1).
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
//! A terminal that belongs to a room (`room` on any view but the TV —
//! wave 7, the server-room terminal) sleeps until the story opens that room
//! to everyone, then speaks the character's lines said there (the door
//! cutscene) through the same speech queue as its line, with a caption; it
//! never shows a story slide or the countdown corner, and it tells the story
//! when a pass opens and closes a line there (`terminal opened` / `closed`;
//! a visit a crash or reload left open is closed on the next boot).
//!
//! `view: reinstall` (wave 18b) is the tent laptop: a wall terminal that is
//! also the reinstallation wizard (`reinstall/ReinstallTerminal.tsx`, a lazy
//! chunk with the reinstall app's own flow). Awake all night; while a walk
//! is on screen it counts as piloting (slides and cutscenes stand aside) and
//! an overlay holds the walk rather than ending it.
//!
//! A tap on the wake overlay (or anywhere on the page) is the one gesture the browser needs
//! before the terminal may make a sound unattended — and, while it is not
//! full screen, every tap asks for full screen again (`fullscreen.ts`, on
//! by default). The screen is held on
//! with a Wake Lock from boot (re-taken on that tap and whenever the page
//! comes back into view), and the ⚙ opens setup only on a 2 s hold
//! (`kiosk.ts`) — a guest's short tap does nothing.
//!
//! The heart (wave 20): the server-room terminal bridges the door sensor
//! (`serial/`, `door=serial`) and shows the room's own scenes (`cue room_*`,
//! `cutscene/scenes/heart.tsx`) whatever it is doing. While a line is open
//! its program's heart menu docks under the thread (`heart/ChoicePanel.tsx`:
//! the newest `Heart …` menu on `dm:<character>`, picked by id), greyed while
//! the door is open; *CLOSE THE DOOR* runs across the top while the heart
//! wants it shut (`heart/DoorOverlay.tsx`). The composer shows when there is
//! a keyboard (`keys`), except while a tree menu (not the heart to heart's
//! ⟦BACK⟧) is docked. Thrown out of his heart, the line ends when the scene
//! has played.

import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MutableRefObject, type ReactNode } from "react";
import { Composer, Thread } from "./chat.tsx";
import { adoptCharacter, baseOf, castCheckKey, characterProblem, dropConfig, hintsFromSearch, loadConfig, provision, roomOf, saveConfig, spotProblem, tvRoomOf, withoutSecrets, type TerminalConfig } from "./config.ts";
import { Setup } from "./Setup.tsx";
import { followMap, followVoice, urlConfig } from "./setup-map.ts";
import { useCamFeed } from "./camfeed.ts";
import { useVoiceLink } from "./voice/hook.ts";
import { MicCue } from "./voice/MicCue.tsx";
import { useCameraLive, type Facing } from "./camera.ts";
import { Face, type FaceHandle } from "./face/Face.tsx";
import { moodOfText, type Mood } from "./face/mood.ts";
import { lineLeash, talkWaitsOnDoor, useIdleTimeout } from "./idle.ts";
import { FilePanel } from "./FilePanel.tsx";
import { VisitLatch, beginPilot, characterIdOf, closeVisit, endPilot, fetchCharacters, openVisit, recoverVisit, tokenAlive, usePilotSession, type Line, type Pilot } from "./pilot.ts";
import { parseScan } from "./scan.ts";
import { Gear, TypedFallback } from "./controls.tsx";
import { Scanner, type CameraState, cameraProblem } from "./scanner.tsx";
import { SpeechQueue, audioUnlocked, unlock, voiceEngines, voiceNote, type EngineKind } from "./speech/engine.ts";
import { useAnnouncements } from "./announce.ts";
import { revealOffsets, splitSentences } from "./speech/split.ts";
import { mayReload, retryable } from "./retry.ts";
import { fetchHouse, useSpatialStream, useWorld, type Gone, type WorldStore } from "./world/stream.ts";
import { fullScreenSim, hasWebGL2 } from "./webgl.ts";
import { linkedNow, linkedPane, usePresenceLatch } from "./world/presence.ts";
import { screenWake } from "./kiosk.ts";
import { kioskFullscreen } from "./fullscreen.ts";
import { setSoundMuted, setSoundView, sfx } from "./sound/bus.ts";
import { drawsSlides, loadCutscenes, screenTargetOf, silentView } from "./cutscene/load.ts";
import { attractOf, useScreenState, watchWhileAsleep, type ScreenState } from "./screen.ts";
import { Attract } from "./Attract.tsx";
import { IdleShow } from "./idle-show/IdleShow.tsx";
import { ScanBox } from "./idle-show/ScanBox.tsx";
import { IdentifyOverlay, LiveScreenLayer } from "./ScreenLayer.tsx";
import { Tv } from "./Tv.tsx";
import type { ReinstallTerminalProps } from "./reinstall/ReinstallTerminal.tsx";
import { PeekClock, canPeek, coverOf, screenLayers } from "./slides.ts";
import { api, withTimeout } from "@loom/play/client.ts";
import { serverNow } from "./cutscene/clock.ts";
import { onSceneFace } from "./cutscene/face-bus.ts";
import { useDoorLink } from "./serial/use-door.ts";
import { useDoorStatus } from "./serial/door-status.ts";
import { doorOpenNow } from "./serial/door-bridge.ts";
import { ChoicePanel } from "./heart/ChoicePanel.tsx";
import { DoorOverlay } from "./heart/DoorOverlay.tsx";
import { CHOOSE_TIMEOUT_MS, chooseBody, chooseErrorText, composerShown, heartMenuOf, heartTouched, isHeartTerminal, menusOf, pilotEndOf, splitTag, type HeartMenu } from "./heart/heart.ts";
import { LinePlayer, cursorAfterGap, cursorWhileAsleep, planVoice, showsNameplate, type TvLine } from "./tv.ts";
import { RoomSpeech } from "./speech/said.ts";

// three.js is most of the weight of the world view — a face-only terminal
// never loads it. Retryable: `lazy` alone caches a failed load forever.
const loadWorld = retryable(() => import("./world/WorldView.tsx").then((m) => ({ default: m.WorldView })));
// chess.js + the King's board + his AI: only the chess terminal loads them.
// The shadow view (wave 14) is three.js too, in its own small chunk.
const loadShadow = retryable(() => import("./shadow/ShadowView.tsx").then((m) => ({ default: m.ShadowView })));
// The raycaster (wave 16): a simple recreation of the game in Canvas 2D, no
// three.js — what a tablet with no WebGL2 draws wherever it would have drawn the world.
const loadRaycast = retryable(() => import("./raycast/RaycastView.tsx").then((m) => ({ default: m.RaycastView })));
const loadChess = retryable(() => import("./chess/ChessTerminal.tsx").then((m) => ({ default: m.ChessTerminal })));
// The casino's tables (wave 15): only the casino terminal loads them.
const loadCasino = retryable(() => import("./casino/CasinoTerminal.tsx").then((m) => ({ default: m.CasinoTerminal })));
// The tent laptop's reinstallation station (wave 18b): the reinstall app's
// flow + game, only on `view=reinstall`.
const loadReinstall = retryable(() => import("./reinstall/ReinstallTerminal.tsx").then((m) => ({ default: m.ReinstallTerminal })));

type Screen = { kind: "setup"; notice: string | null; step?: "connect" | "character" } | { kind: "attract" } | { kind: "connecting"; id: string } | { kind: "piloting"; pilot: Pilot };

export function App() {
  const [config, setConfig] = useState<TerminalConfig | null>(() => loadConfig());
  const [screen, setScreen] = useState<Screen>(() => (loadConfig() ? { kind: "attract" } : { kind: "setup", notice: null }));
  const [awake, setAwake] = useState(() => audioUnlocked());
  // The tent laptop (`view=reinstall`) has a walk or the wizard on screen.
  const [reinstallBusy, setReinstallBusy] = useState(false);
  // The lean screen state, polled every 2 s (also this terminal's heartbeat).
  // The TV also asks for its room's new lines after its chat cursor (K-18);
  // a room terminal names its room and the same cursor (wave 7).
  const voiceCursor = useRef<number | null>(null);
  useEffect(() => {
    voiceCursor.current = null; // a new config starts at the room's head: no backlog
  }, [config]);
  // What the TV / a room terminal has said of its room's lines (wave 25: the
  // poll's `talk` / `said`, which a desk `speech` step waits on). The player
  // that speaks them attaches while mounted.
  const [speech] = useState(() => new RoomSpeech());
  const room = config === null ? null : roomOf(config);
  const screenState = useScreenState(
    config,
    config?.view === "tv"
      ? () => ({ room: tvRoomOf(config), after: voiceCursor.current, speech: speech.report(voiceCursor.current) })
      : room !== null
        ? () => ({ room, after: voiceCursor.current, as: "room" as const, speech: speech.report(voiceCursor.current) })
        : null,
  );
  // The room's head off every answer (what "finished" means with nothing mounted).
  useEffect(() => {
    const head = screenState.state?.voice?.head;
    if (typeof head === "number") speech.heard(head);
  }, [speech, screenState.state]);
  // The queue drained (talk 1 → 0): tell the desk now, not on the next tick.
  const { pollNow } = screenState;
  useEffect(() => speech.onDrain(pollNow), [speech, pollNow]);
  // A room terminal asleep: nothing is mounted to hear its room, so its
  // cursor follows the head here — the lines that come with the wake (the
  // door cutscene) are then spoken, not resynced away (`cursorWhileAsleep`).
  const asleep = attractOf(screenState.state, room !== null);
  // Wave 26 (R5): a wall watches only while a player is in its room in the
  // game (latched 3 s, so a doorway crossing never flips the whole screen).
  const watching = usePresenceLatch(config !== null && asleep && watchWhileAsleep(screenState.state, config.view, room !== null, config.spot));
  useEffect(() => {
    const voice = screenState.state?.voice;
    if (room === null || !asleep || voice === null || voice === undefined) return;
    voiceCursor.current = cursorWhileAsleep(voice, voiceCursor.current);
  }, [room, asleep, screenState.state]);
  // A room terminal's open visit (`terminal opened` → `closed`): held here,
  // not in the line pane, which can remount mid-connect (the room closing
  // under a scan) and would then lose the visit it opened.
  const visits = useRef(new VisitLatch());
  // A visit the last page left open (it crashed or reloaded mid-line) is
  // closed first thing, before anything here pilots — once per page; the
  // first `terminal opened` waits for it (`recoverVisit`).
  useEffect(() => {
    if (config !== null) void recoverVisit(config, visits.current);
  }, [config]);
  // The house announcements (N-09), when this screen is set to say them.
  const announcement = useAnnouncements(config, screenState.state);
  // The door sensor (wave 20): the bridge runs whatever the screen shows, so
  // the story hears the door on attract, during a line and in setup alike.
  useDoorLink(config, screenState.state);
  const door = useDoorStatus();
  const doorOpen = doorOpenNow(door.sensor, screenState.state?.night ?? null, Date.now());
  // The camera feed (wave 14): a placed terminal sends its camera to the games.
  useCamFeed(config);
  // The voice link (wave 19): this room heard in the games at this screen,
  // the players near it heard out of its speaker — per the view and the
  // map's `voice` (`voice/roles.ts`), never on the setup screen. Capture
  // and playback wait for the context to run: the first touch anywhere
  // (below), or at once on the TV's Chrome.
  const voiceHouse = useVoiceLink(config, screen.kind !== "setup");
  // The map turned this spot's link on or off: keep the stored flag in step.
  useEffect(() => {
    if (config === null || voiceHouse === null) return;
    const next = followVoice(config, voiceHouse);
    if (next === null) return;
    saveConfig(next);
    setConfig(next);
  }, [config, voiceHouse]);

  // Fetch the world view's code at boot, while this page and the server are
  // known to match — hours later a rebuild may have renamed the chunk. Not
  // on a tablet that can't draw it (no WebGL2 → face only, see `webgl.ts`).
  const webgl2 = hasWebGL2();
  const view = config?.view;
  useEffect(() => {
    if (webgl2 && view !== undefined && view !== "face" && view !== "chess" && view !== "casino") void loadWorld().catch(() => {});
    if (!webgl2 && view !== undefined && view !== "face" && view !== "tv" && view !== "chess" && view !== "casino") void loadRaycast().catch(() => {});
    if (webgl2 && (view === "shadow" || view === "auto")) void loadShadow().catch(() => {});
    if (view === "chess") void loadChess().catch(() => {});
    if (view === "casino") void loadCasino().catch(() => {});
    if (view === "reinstall") void loadReinstall().catch(() => {});
  }, [view, webgl2]);
  useEffect(() => {
    if (view !== "reinstall") setReinstallBusy(false);
  }, [view]);
  // The cutscenes, on every screen that draws slides (wave 17).
  const slides = view !== undefined && drawsSlides(view, room);
  useEffect(() => {
    if (slides) void loadCutscenes().catch(() => {});
  }, [slides]);

  // Provision from the URL (`?code=…&name=…`) — a fleet is set up by opening one link each.
  useEffect(() => {
    const hints = hintsFromSearch(window.location.search);
    if (hints.code === "") return;
    window.history.replaceState(null, "", `${window.location.pathname}${withoutSecrets(window.location.search)}`);
    void provision(hints.code, hints)
      .then(async (given) => {
        // With a spot: that terminal of the event's live map (name, screen,
        // room), the link's own fields winning. A spot the map lacks: say so
        // rather than hang no window.
        const house = given.spot === "" ? null : await fetchHouse(given).then((h) => h.house, () => null);
        const c = urlConfig(given, hints, house);
        saveConfig(c);
        setConfig(c);
        const problem = house === null ? null : spotProblem(c.spot, house);
        setScreen(problem === null ? { kind: "attract" } : { kind: "setup", notice: problem });
      })
      .catch((e: Error) => setScreen({ kind: "setup", notice: e.message }));
  }, []);

  // Set up from the map: follow that map entry's name / screen / room as the
  // event plays it now (a variant switch, a director's save). Once per boot.
  const followed = useRef(false);
  useEffect(() => {
    if (config === null || followed.current || config.fromMap !== true) return;
    followed.current = true;
    void fetchHouse(config)
      .then((h) => {
        const next = followMap(config, h.house);
        if (next === null) return;
        saveConfig(next);
        setConfig(next);
      })
      .catch(() => {});
  }, [config]);

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

  // The screen state names the character in the story's own spelling: a
  // tablet set up as `trabolta` when the server couldn't check the name (no
  // cast to give, a failed ⚙ lookup) adopts `Trabolta`, so its line is the guest's
  // real `dm:Trabolta` thread (B19).
  useEffect(() => {
    if (config === null) return;
    const next = adoptCharacter(config, screenState.state?.character?.id);
    if (next === null) return;
    saveConfig(next);
    setConfig(next);
  }, [config, screenState.state]);

  // The screen state names no character for this terminal although it asked
  // for one: before the doors that is "no sim yet", after them a name the
  // story lacks (stored unchecked). Ask the cast once per sim — a mod read
  // that answers with the declared cast before the doors too; a name the story lacks sends the terminal to setup
  // with the error rather than piloting guests into a `dm:<typo>` thread no
  // agent hears (B19).
  const castKey = config === null ? null : castCheckKey(config, screenState.state);
  const [castProblem, setCastProblem] = useState<{ key: string; problem: string } | null>(null);
  const castAsked = useRef<string | null>(null);
  useEffect(() => {
    if (config === null || castKey === null || castAsked.current === castKey) return;
    castAsked.current = castKey;
    // Kept with its key: an answer for an older key never counts.
    void fetchCharacters(config)
      .then((cast) => {
        const problem = characterProblem(config.character, cast);
        setCastProblem(problem === null ? null : { key: castKey, problem });
      })
      .catch(() => {
        if (castAsked.current === castKey) castAsked.current = null; // ask again on a later poll
      });
  }, [config, castKey, screenState.state]);
  const badCharacter = castProblem !== null && castProblem.key === castKey ? castProblem.problem : null;
  useEffect(() => {
    if (badCharacter === null || screen.kind === "setup" || screen.kind === "piloting") return;
    setScreen({ kind: "setup", notice: `${badCharacter} Set this terminal's character (under advanced).`, step: "character" });
  }, [badCharacter, screen.kind]);

  // The poll's event is gone (ended; a new one launched): back to setup, the
  // config kept so its name / character / spot carry over — like `onGone`.
  useEffect(() => {
    if (!screenState.ended) return;
    setScreen({ kind: "setup", notice: "The event this terminal was part of has ended — enter the moderator passcode of the next one.", step: "connect" });
  }, [screenState.ended]);

  // Keep the screen on from boot: Chrome grants a wake lock to a visible
  // page without a gesture; `ScreenWake` re-takes it on every return to view.
  useEffect(() => {
    void screenWake().keepOn();
  }, []);

  // Full screen by default (D7): from now on every tap while not full screen
  // asks again (`fullscreen.ts`); ⚙ can turn it off for this terminal.
  const fullscreen = config?.fullscreen !== false;
  useEffect(() => {
    kioskFullscreen().setEnabled(fullscreen);
  }, [fullscreen]);
  // The effects' level follows the view (the TV's are quieter); the mirror
  // fallback stays silent (X5).
  useEffect(() => setSoundView(config?.view), [config?.view]);
  const silent = config !== null && silentView(config.view);
  useEffect(() => {
    if (!silent) return;
    setSoundMuted(true);
    return () => setSoundMuted(false);
  }, [silent]);

  const wake = useCallback(() => {
    void kioskFullscreen().request();
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
      setScreen({ kind: "setup", notice: "The event this terminal was part of has ended — enter the moderator passcode of the next one.", step: "connect" });
    }
  }, []);

  // A tap on a slide held over the scanner peeks under it (B21) until
  // nobody has touched the terminal for `PEEK_MS`; overlays still cover.
  // `PeekClock` (slides.ts) is the tested state machine; this only feeds it.
  const peekClock = useRef(new PeekClock());
  const [, setPeekTick] = useState(0);
  const peekable = config !== null && room === null && canPeek(config.view, screen.kind, asleep);
  const peek = peekClock.current.on(Date.now(), peekable);
  const onSlideTap = useCallback(() => {
    peekClock.current.tap(Date.now());
    setPeekTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!peek) return;
    const onInput = () => peekClock.current.touch(Date.now());
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    // Re-ask the clock every second so the slide comes back on its own.
    const tick = window.setInterval(() => setPeekTick((n) => n + 1), 1000);
    return () => {
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
      window.clearInterval(tick);
    };
  }, [peek]);

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
        step={screen.kind === "setup" ? screen.step : undefined}
        spotAnnounce={screenState.state?.spot?.announce ?? null}
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
  // A walk on the tent laptop is a pilot to the screen layer: slides and
  // cutscenes stand aside, and an overlay still covers it (and holds it).
  const piloting = screen.kind === "piloting" || screen.kind === "connecting" || (config.view === "reinstall" && reinstallBusy);
  // The chess board is layered like a room terminal: overlays only, never a
  // story slide, the countdown corner or the Y2K clock.
  const bare = room !== null || config.view === "chess" || config.view === "casino";
  // The tent's kiosk (wave 26, T3) takes no story slide, corner or Y2K
  // clock; its overlays, beat cutscenes and the glitch still play.
  const station = config.view === "reinstall";
  // An overlay (blackout / go to the living room / alarm) ends any pilot
  // (and covers a chess game, which it holds rather than ends). A slide, an
  // overlay or the glitch over the idle show pauses it (no popup dings under
  // a scene). The glitch (wave 26, T2) is covered, never a takeover: a pilot,
  // a chess game or a tent walk keeps running under its 8 s.
  const { takeover, covered } = coverOf(screenLayers(screenState.state, Date.now(), { piloting, peek, room: bare, slides: !station }));
  // The heart terminal: the server room's own room terminal, or any with a door sensor.
  const heartTerminal = isHeartTerminal(room, config.door);
  const layer = (
    <>
      {heartTerminal && <DoorOverlay doorOpen={doorOpen} stage={screenState.state?.night.heart_stage ?? null} />}
      {/* A sensor fault is never on a guest's screen (D29: the sensor is the door): ⚙ and Run → Terminals show it. */}
      {/* A slide's .mp4 plays on the TV only (N-04a); the tablets keep the PNG. */}
      <LiveScreenLayer state={screenState.state} piloting={piloting} peek={peek} room={bare} slides={!station} onSlideTap={peekable && !station ? onSlideTap : undefined} video={config.view === "tv"} cutscenes={drawsSlides(config.view, room)} gear={<Gear onOpen={openSetup} label="Set up this terminal" className="mirror-gear" />} />
      <IdentifyOverlay state={screenState.state} name={config.name} spot={config.spot} view={config.view} />
      <MicCue />
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
      name={config.name}
      state={screenState.state}
      character={config.character}
      target={screenTargetOf(config.view)}
      covered={covered}
      corner={
        <>
          <div className="mirror-corner">
            {config.title ? `${config.title} · ` : ""}
            {config.name.toUpperCase()}
            {room !== null && screenState.state?.room?.id === "" && <div className="room-problem">the story has no room called "{room}" — this terminal sleeps until it is set right</div>}
          </div>
          <Gear onOpen={openSetup} label="Set up this terminal" className="mirror-gear" />
        </>
      }
    />
  );

  const wakeOverlay = !awake && (
    <button className="wake" onClick={wake}>
      <span className="wake-title">TOUCH TO WAKE</span>
      <span className="wake-sub">this terminal needs one touch before it may speak</span>
    </button>
  );

  if (config.view === "tv") {
    return (
      <>
        <Tv
          config={config}
          state={screenState.state}
          cursor={voiceCursor}
          speech={speech}
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

  if (config.view === "chess") {
    // Awake all night: the King is not the character, so no screensaver.
    return (
      <>
        <ChessSlot config={config} state={screenState.state} polled={screenState.reachable} takeover={takeover} onSetup={openSetup} />
        {layer}
      </>
    );
  }

  if (config.view === "casino") {
    // Awake all night, like the board.
    return (
      <>
        <CasinoSlot config={config} state={screenState.state} polled={screenState.reachable} takeover={takeover} onSetup={openSetup} />
        {layer}
      </>
    );
  }

  if (config.view === "reinstall") {
    // Awake all night: a reinstallation station, whatever the character does.
    return (
      <>
        <ReinstallSlot
          config={config}
          state={screenState.state}
          polled={screenState.reachable}
          takeover={takeover}
          covered={covered}
          asleep={asleep}
          onSetup={openSetup}
          onGone={onGone}
          onBusy={setReinstallBusy}
          worldSlot={(store, size) => <WorldSlot store={store} spotId={config.spot} size={size} recover="retry" raycast={!webgl2} />}
        />
        {wakeOverlay}
        {layer}
      </>
    );
  }

  if (config.view === "mirror" || config.view === "shadow") {
    return (
      <>
        {asleep && !watching ? attractScreen : <Mirror config={config} canDraw={webgl2} onSetup={openSetup} onGone={onGone} />}
        {layer}
      </>
    );
  }

  // The character is hidden or asleep: the screensaver, unless a line is
  // already open (a pilot ends on its own leash, then attract takes over).
  if (asleep && screen.kind !== "piloting") {
    // A program is reinstalling while the character sleeps: watch it, no line.
    if (watching) {
      return (
        <>
          <Mirror config={config} canDraw={webgl2} onSetup={openSetup} onGone={onGone} />
          {layer}
        </>
      );
    }
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
        state={screenState.state}
        asleep={asleep}
        voiceCursor={voiceCursor}
        speech={speech}
        visits={visits}
        doorOpen={heartTerminal ? doorOpen : null}
        takeover={takeover}
        covered={covered}
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
function WorldSlot({ store, spotId, size, recover, raycast = false }: { store: WorldStore; spotId: string; size: "pane" | "full"; recover: "retry" | "reload"; raycast?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  // A fresh `lazy` per attempt: React caches each one's settled payload.
  // `raycast`: the Canvas 2D raycaster (no WebGL2) in place of the three.js world.
  const View = useMemo(() => lazy(raycast ? loadRaycast : loadWorld), [attempt, raycast]);
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

// --- the shadow view, guarded -------------------------------------------------

/**
 * The shadow view (wave 14) — the camera with the players as ghosts in it —
 * falling back to the world view for good when it can't run here (no
 * camera, no spot on the map, no WebGL, or its chunk failed).
 */
function ShadowSlot({ store, spotId, facing, size, recover }: { store: WorldStore; spotId: string; facing: Facing; size: "pane" | "full"; recover: "retry" | "reload" }) {
  const [off, setOff] = useState(spotId.trim() === "");
  const View = useMemo(() => lazy(loadShadow), []);
  const world = <WorldSlot store={store} spotId={spotId} size={size} recover={recover} />;
  if (off) return world;
  return (
    <WorldBoundary fallback={world} onError={() => setOff(true)}>
      <Suspense fallback={size === "full" ? <div className="world-note blink">OPENING THE SHADOW…</div> : null}>
        <View store={store} spotId={spotId} facing={facing} onUnavailable={() => setOff(true)} />
      </Suspense>
    </WorldBoundary>
  );
}

// --- the chess board, guarded ---------------------------------------------------

type SlotProps = { config: TerminalConfig; state: ScreenState | null; polled: boolean; takeover: boolean; onSetup: () => void };

function ChessSlot(props: SlotProps) {
  return <LazySlot {...props} load={loadChess} cls="chess" failed="THE BOARD DIDN'T LOAD — RETRYING…" loading="SETTING UP THE BOARD…" />;
}

function CasinoSlot(props: SlotProps) {
  return <LazySlot {...props} load={loadCasino} cls="casino" failed="THE CASINO DIDN'T LOAD — RETRYING…" loading="OPENING THE CASINO…" />;
}

/** The tent laptop's reinstallation station (wave 18b), guarded like the
 *  board. Busy (a walk or the wizard on screen) is the station's to report,
 *  but never outlives it: a station that crashes into the boundary, or
 *  unmounts mid-walk without saying so, must not keep slides and cutscenes
 *  hidden until the retry. */
function ReinstallSlot(props: ReinstallTerminalProps) {
  const busy = useRef(props.onBusy);
  busy.current = props.onBusy;
  useEffect(() => () => busy.current(false), []);
  const onBroken = useCallback(() => busy.current(false), []);
  return <LazySlot {...props} load={loadReinstall} cls="reinstall" failed="THE REINSTALLATION WIZARD DIDN'T LOAD — RETRYING…" loading="STARTING THE REINSTALLATION WIZARD…" onBroken={onBroken} />;
}

/** A lazy screen (the chess board, the casino, the reinstallation station)
 *  behind an error boundary: a failed load says so and is tried again
 *  `WORLD_RETRY_MS` later, in place. */
function LazySlot<P extends SlotProps>({
  load,
  cls,
  failed,
  loading,
  onBroken,
  ...rest
}: P & { load: () => Promise<{ default: (p: P) => ReactNode }>; cls: string; failed: string; loading: string; onBroken?: () => void }) {
  const props = rest as unknown as P;
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  const View = useMemo(() => lazy(load) as unknown as ComponentType<SlotProps>, [attempt, load]);
  useEffect(() => {
    if (!broken) return;
    const t = window.setTimeout(() => {
      setBroken(false);
      setAttempt((a) => a + 1);
    }, WORLD_RETRY_MS);
    return () => window.clearTimeout(t);
  }, [broken]);
  const note = (text: string) => (
    <div className={`terminal ${cls}`}>
      <div className="world-note blink">{text}</div>
      <Gear onOpen={props.onSetup} label="Set up this terminal" className="mirror-gear" />
    </div>
  );
  return (
    <WorldBoundary
      key={attempt}
      fallback={note(failed)}
      onError={() => {
        setBroken(true);
        onBroken?.();
      }}
    >
      <Suspense fallback={note(loading)}>
        <View {...props} />
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
  state,
  asleep,
  voiceCursor,
  speech,
  visits,
  doorOpen,
  takeover,
  covered,
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
  /** The last screen state (a room terminal reads its room's lines off it). */
  state: ScreenState | null;
  /** On attract (a pilot outlasts it on its own leash). */
  asleep: boolean;
  /** The room voice's chat cursor (owned by the app: it moves while asleep). */
  voiceCursor: MutableRefObject<number | null>;
  /** The room speech the poll reports (wave 25; owned by the app). */
  speech: RoomSpeech;
  /** The open visit at a room terminal (owned by the app, like the cursor). */
  visits: MutableRefObject<VisitLatch>;
  /** The server-room door, as the heart reads it (null: not a heart terminal, or nobody knows). */
  doorOpen: boolean | null;
  /** A story overlay covers the screen: no scanning, and an open line ends. */
  takeover: boolean;
  /** A slide or an overlay covers the screen: the idle show pauses under it. */
  covered: boolean;
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
  /** A room line being said resolves here when its utterance is done (or cut). */
  const waiters = useRef(new Map<number, () => void>());
  const room = roomOf(config);
  // A room scene's face mood (wave 20: the heart's scenes) reaches this face.
  useEffect(() => onSceneFace((m, ms) => face.current?.flash(m, ms)), []);
  // The pane going away with a line open (⚙ setup over a pilot): the story
  // still hears the visit close.
  const configRef = useRef(config);
  configRef.current = config;
  useEffect(() => () => void closeVisit(configRef.current, visits.current), [visits]);

  // --- the reinstallation simulation, beside the scanner ---
  const view = config.view;
  const world = useSpatialStream(config, view !== "face");
  const inSimulation = useWorld(world, (s) => s.world.players.size > 0);
  useGone(world, onGone);
  // Wave 26 (R5): the pane shows the Internet only while a player is in this
  // spot's room in the game (the server's `spot.here`; the house-wide rule
  // only when it sends none), never with no spot; latched 3 s.
  const linked = usePresenceLatch(linkedNow({ view, spot: config.spot, here: state?.spot, anyone: inSimulation }));
  // `auto` shows the shadow (the camera, the players as ghosts in it) instead
  // of the world while the camera is live and this terminal is placed; a
  // tablet with no WebGL2 draws the raycaster instead of either.
  const cameraLive = useCameraLive();
  const pane = screen.kind === "attract" ? linkedPane(view, hasWebGL2(), linked, cameraLive && config.spot.trim() !== "") : "none";
  const showWorld = pane !== "none";

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
        waiters.current.get(id)?.();
        waiters.current.delete(id);
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

  // --- the room voice (a room terminal: the character's lines in its room) ---
  const [roomLine, setRoomLine] = useState<TvLine | null>(null);
  const [roomBusy, setRoomBusy] = useState(false);
  const roomLinger = useRef(0);
  const roomPlayer = useMemo(
    () =>
      new LinePlayer({
        caption: (line) => {
          window.clearTimeout(roomLinger.current);
          setRoomLine(line);
          if (line !== null) setRoomBusy(true);
          if (line !== null && line.mode !== "speak") setMood(moodOfText(line.text));
        },
        speak: (line) =>
          new Promise<void>((resolve) => {
            const chunks = splitSentences(line.text);
            if (chunks.length === 0) return resolve();
            chunkText.current.set(line.seq, chunks);
            waiters.current.set(line.seq, resolve);
            queue.say({ id: line.seq, chunks });
          }),
        cancel: () => {
          queue.stop();
          for (const w of waiters.current.values()) w();
          waiters.current.clear();
          setSpeaking(false);
        },
        sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
        idle: () => {
          setRoomBusy(false);
          window.clearTimeout(roomLinger.current);
          roomLinger.current = window.setTimeout(() => setRoomLine(null), 6000);
        },
      }, room !== null ? speech : null),
    [queue, room, speech],
  );
  // A room terminal speaks its room's lines while mounted (`talk` / `said`).
  useEffect(() => (room === null ? undefined : speech.attach()), [room, speech]);
  useEffect(
    () => () => {
      roomPlayer.stop();
      window.clearTimeout(roomLinger.current);
    },
    [roomPlayer],
  );
  // Every poll: the room's new lines → the player (the cursor moves first).
  // Never muted — the TV's mute is the TV's.
  const lastAnswer = useRef<number | null>(null);
  useEffect(() => {
    const voice = state?.voice;
    if (room === null || state === null || voice === null || voice === undefined) return;
    const from = cursorAfterGap(voiceCursor.current, lastAnswer.current, state.receivedAt);
    lastAnswer.current = state.receivedAt;
    const plan = planVoice(voice, from, { character: config.character, muted: false, attract: asleep });
    voiceCursor.current = plan.cursor;
    roomPlayer.push(plan.lines);
  }, [room, state, asleep, config.character, voiceCursor, roomPlayer]);
  // A room terminal going back to sleep (a restart, the room closed) stops
  // the room voice. Only a room terminal: a house terminal's open line keeps
  // its reply going when the character falls asleep mid-sentence.
  useEffect(() => {
    if (!asleep || room === null) return;
    roomPlayer.stop();
    setRoomLine(null);
    setRoomBusy(false);
  }, [asleep, room, roomPlayer]);

  // --- the leash ---
  const end = useCallback(
    (why: "timeout" | "dead" | "left" | "thrown" | "done") => {
      if (pilot === null) return;
      roomPlayer.stop(); // stops the queue too, and releases a room line's waiter
      queue.stop();
      setSpeaking(false);
      setRevealed(new Map());
      setMood("glitch");
      window.setTimeout(() => setMood("idle"), 1200);
      setScreen({ kind: "attract" });
      if (why === "timeout") setFlash(`${pilot.name.toUpperCase()} DISCONNECTED — NO INPUT`);
      else if (why === "dead") setFlash("CONNECTION LOST — THE SYSTEM RESTARTED");
      else if (why === "thrown") setFlash(`${pilot.name.toUpperCase()} — ACCESS TO THE HEART TERMINATED`);
      void endPilot(config, pilot);
      // A room terminal: the story hears the line close (best-effort; also
      // after a restart, whose replay re-opened the visit).
      void closeVisit(config, visits.current);
    },
    [pilot, queue, roomPlayer, config, setScreen, visits],
  );
  // The page going away mid-line (a reload, the kiosk app closing): close the
  // visit and the session with requests that outlive the page.
  useEffect(() => {
    if (pilot === null) return;
    const onHide = () => {
      void closeVisit(config, visits.current, { keepalive: true });
      void endPilot(config, pilot, { keepalive: true });
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [pilot, config, visits]);
  // The heart terminal's file panel (a room terminal, wave 11): open, it
  // lengthens the leash (choosing a file to hand him takes a while) but
  // never holds it — a guest who walks away still gets disconnected.
  const [filesOpen, setFilesOpen] = useState(false);
  useEffect(() => setFilesOpen(false), [pilot]);
  // --- the heart (wave 20) ---
  // When this line opened, on the server's clock (a heart scene since then holds the long leash).
  // Read in render the moment the pilot changes (never a frame late: an older
  // line's eject cue must not end this one).
  const pilotSince = useRef(0);
  const sinceFor = useRef<Pilot | null>(null);
  if (pilot !== sinceFor.current) {
    sinceFor.current = pilot;
    pilotSince.current = pilot === null ? 0 : serverNow(state);
  }
  const characterId = characterIdOf(config.character, session.view);
  const menu: HeartMenu | null = pilot === null ? null : heartMenuOf(menusOf(session.view), characterId);
  // The heart to heart after *not yet* / Leave keeps the long leash once the
  // program types: the thread's newest seq when that cue was first seen, and
  // a line of theirs past it. (A chat line's `ts` is story time, the cue's
  // `at` server time: seqs, not clocks.)
  const cueNow = state?.room?.cue ?? null;
  const cueMark = useRef<{ seq: number; lineSeq: number } | null>(null);
  if (cueNow !== null && cueMark.current?.seq !== cueNow.seq) cueMark.current = { seq: cueNow.seq, lineSeq: session.lines.reduce((mx, l) => Math.max(mx, l.seq), -1) };
  const typedAfter = pilot !== null && cueMark.current !== null && session.lines.some((l) => !l.theirs && l.from === pilot.name && l.seq > cueMark.current!.lineSeq);
  const heart = menu !== null || (pilot !== null && heartTouched(cueNow, pilotSince.current, typedAfter));
  const [echoes, setEchoes] = useState<Array<{ key: string; text: string; after: number }>>([]);
  useEffect(() => setEchoes([]), [pilot]);
  const choose = useCallback(
    async (m: HeartMenu, index: number) => {
      if (pilot === null) return;
      try {
        await withTimeout(api(`${baseOf(config)}/api/guest/choose`, chooseBody(m, index), pilot.token), CHOOSE_TIMEOUT_MS);
      } catch (e) {
        // The menu moved under the click, or is gone (null): the next view redraws it.
        const text = chooseErrorText(e);
        if (text === null) return;
        throw new Error(text);
      }
      const after = session.lines.reduce((mx, l) => Math.max(mx, l.seq), -1);
      setEchoes((list) => [...list, { key: `${m.id}:${index}`, text: splitTag(m.options[index] ?? "").text, after }]);
    },
    [config, pilot, session.lines],
  );
  const leash = lineLeash({ answering: session.typing || speaking || queue.busy || roomBusy, filesOpen, heart, doorOpen: doorOpen === true && talkWaitsOnDoor(state?.night?.heart_stage) });
  const busy = leash.busy;
  const { touch, warning, remaining } = useIdleTimeout({ active: pilot !== null, busy, limit: leash.limit, warnMs: leash.warnMs, onTimeout: () => end("timeout") });
  useEffect(() => {
    if (session.dead !== null && pilot !== null) end("dead");
  }, [session.dead, pilot, end]);
  useEffect(() => {
    if (takeover && pilot !== null) end("left");
  }, [takeover, pilot, end]);
  // Thrown out of his heart (and, on a mouse-only rig, *not yet* / a leave):
  // the line ends once that room scene has played (D24).
  const endRef = useRef(end);
  endRef.current = end;
  const roomCue = state?.room?.cue ?? null;
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (pilot === null || roomCue === null) return;
    // An eject ends the line whether or not a menu docked: Heart Barred
    // (a barred program's re-scan) docks none, and has no heart to heart.
    const plan = pilotEndOf(roomCue, pilotSince.current, config.keys);
    if (plan === null) return;
    const wait = Math.max(0, roomCue.at + plan.ms - serverNow(stateRef.current));
    const t = window.setTimeout(() => endRef.current(plan.why), wait);
    return () => window.clearTimeout(t);
    // The cue's seq / at decide; a new pilot or cue reschedules.
  }, [pilot, roomCue?.seq, roomCue?.at, roomCue?.value, config.keys]);

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
      if (roomBusy) {
        setFlash(`LISTEN — ${config.character.toUpperCase()} IS SPEAKING`);
        return;
      }
      setScreen({ kind: "connecting", id: guestId });
      setMood("attentive");
      try {
        const p = await beginPilot(config, guestId);
        setScreen({ kind: "piloting", pilot: p });
        setFlash(null);
        // A room terminal tells the story the line opened here (never awaited).
        openVisit(config, visits.current, p.id);
      } catch (e) {
        const msg = (e as Error).message;
        setFlash(/unknown guest/i.test(msg) ? "UNKNOWN PROGRAM — REGISTER ON YOUR PHONE FIRST" : /moderators only/i.test(msg) ? "THIS TERMINAL LOST ITS ACCESS" : `CONNECTION FAILED — ${msg.toUpperCase()}`);
        setMood("glitch");
        window.setTimeout(() => setMood("idle"), 1200);
        setScreen({ kind: "attract" });
      }
    },
    [config, roomBusy, screen.kind, setScreen, visits],
  );
  const onCode = useCallback(
    (text: string) => {
      const hit = parseScan(text);
      sfx(hit.kind === "guest" ? "blip" : "buzz", { gain: 0.6 }); // the box heard it (quiet; never over a voice)
      if (hit.kind === "guest") void connect(hit.id);
      else if (hit.kind === "wall") setFlash("THAT'S A WALL CODE — SHOW ME YOUR PASS");
      else setFlash("UNREADABLE — SHOW ME YOUR PASS");
    },
    [connect],
  );

  // The idle show plays while the terminal waits and nobody is speaking in its room.
  const idle = screen.kind === "attract" && !roomBusy && roomLine === null;
  // The face under a full-screen idle show is covered: it sleeps (OB-2),
  // except while the show's `face` layout lets it through.
  const [idleLayout, setIdleLayout] = useState("");
  const scanBox = useRef<HTMLElement>(null);

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

      <main className={`stage${screen.kind === "attract" ? " idle" : ""}${showWorld ? " with-world" : ""}`}>
        <section className={`face-pane${showWorld ? " showing-world" : ""}`}>
          {/* The face stays mounted under the world view: it holds the speech
              queue's level handle and its own easing state. */}
          <Face mood={mood} speaking={speaking} handle={face} paused={idle && !covered && !showWorld && idleLayout !== "face"} />
          {showsNameplate(state) && <div className="nameplate">{config.character.toUpperCase()}</div>}
          {voiceNote(config.engine, engineUsed, latched) !== null && <div className="engine-note">{voiceNote(config.engine, engineUsed, latched)}</div>}
          {showWorld && (pane === "shadow" ? <ShadowSlot store={world} spotId={config.spot} facing={config.camera} size="pane" recover="retry" /> : <WorldSlot store={world} spotId={config.spot} size="pane" recover="retry" raycast={pane === "raycast"} />)}
          {roomLine !== null && (
            <div className={`room-caption${roomLine.mode === "speak" ? "" : " text-only"}`} data-mode={roomLine.mode}>
              {roomLine.from !== config.character && <span className="room-caption-who">{roomLine.from}: </span>}
              {roomLine.text}
            </div>
          )}
        </section>

        <section className={`line-pane${room !== null && pilot !== null && !filesOpen ? " with-files" : ""}`}>
          {screen.kind === "connecting" && (
            <div className="attract">
              <div className="big blink">CONNECTING…</div>
            </div>
          )}
          {screen.kind === "piloting" && pilot !== null && filesOpen && <FilePanel config={config} pilot={pilot} view={session.view} character={characterIdOf(config.character, session.view)} onClose={() => setFilesOpen(false)} onActivity={touch} />}
          {screen.kind === "piloting" && pilot !== null && !filesOpen && (
            <>
              {room !== null && (
                <button type="button" className="file-open" onClick={() => setFilesOpen(true)}>
                  📎 GIVE HIM A FILE
                </button>
              )}
              <Thread lines={session.lines} revealed={revealed} typing={session.typing} character={config.character} guestName={pilot.name} echoes={echoes} />
              {menu !== null && !composerShown({ keys: config.keys, menu }) && (
                <ChoicePanel menu={menu} doorOpen={doorOpen} numberKeys={true} onActivity={touch} onPick={(i) => choose(menu, i)} />
              )}
              {composerShown({ keys: config.keys, menu }) && (
                <Composer
                  onSend={async (t) => {
                    touch();
                    await session.say(t);
                  }}
                  disabled={!session.ready}
                  onInput={touch}
                  placeholder={session.ready ? `say something to ${config.character}` : "connecting…"}
                />
              )}
              {menu !== null && composerShown({ keys: config.keys, menu }) && <ChoicePanel menu={menu} doorOpen={doorOpen} numberKeys={false} onActivity={touch} onPick={(i) => choose(menu, i)} />}
            </>
          )}
        </section>

        {/* The idle show (wave 17, D1) over the stage while nobody is on the
            line — the world keeps its pane beside it — and the scan box in the
            corner above it: the camera always drawn, a pass read whatever
            plays. A pass connecting, a line, or the room's voice puts it away. */}
        <IdleShow name={config.name} state={state} asleep={asleep} character={config.character} target="wall" active={idle && !covered} region={showWorld ? "pane" : "full"} reserveRef={scanBox} onLayout={setIdleLayout} />
        {screen.kind === "attract" && (
          <ScanBox
            boxRef={scanBox}
            scanner={<Scanner facing={config.camera} active={!takeover && !roomBusy} onCode={onCode} onState={setCamera} />}
            listen={roomBusy ? `${config.character.toUpperCase()} IS SPEAKING — scan your pass when he is done` : null}
            problem={cameraProblem(camera)}
            typedOpen={typedOpen}
            onToggleTyped={() => setTypedOpen((o) => !o)}
            typed={
              <TypedFallback
                config={config}
                onPick={(id) => {
                  setTypedOpen(false);
                  void connect(id);
                }}
                onProblem={setFlash}
              />
            }
          />
        )}
      </main>

      {flash !== null && <div className="flash">{flash}</div>}
      {warning !== null && pilot !== null && <div className="leash">{filesOpen ? "STILL THERE? " : ""}DISCONNECTING IN {warning} — TOUCH TO STAY</div>}
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

// --- the mirror ----------------------------------------------------------------

/** `view: mirror` (and `shadow`, the camera with the ghosts in it) — the simulation full screen, for a TV: nothing to scan,
 *  nothing to say (so no wake gesture is needed), only the gear. A screen
 *  with no WebGL2 (`canDraw` false) draws the raycaster instead. */
function Mirror({ config, canDraw, onSetup, onGone }: { config: TerminalConfig; canDraw: boolean; onSetup: () => void; onGone: (g: Gone) => void }) {
  const world = useSpatialStream(config, true);
  const sim = fullScreenSim(config.view === "shadow" ? "shadow" : "mirror", canDraw);
  const connected = useWorld(world, (s) => s.connected);
  useGone(world, onGone);
  return (
    <div className="terminal mirror">
      {sim === "shadow" ? (
        <ShadowSlot store={world} spotId={config.spot} facing={config.camera} size="full" recover="reload" />
      ) : (
        <WorldSlot store={world} spotId={config.spot} size="full" recover="reload" raycast={sim === "raycast"} />
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
