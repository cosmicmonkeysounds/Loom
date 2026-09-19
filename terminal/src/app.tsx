//! The terminal, screen by screen:
//!
//!   setup      — provision this tablet (moderator passcode → token), name it,
//!                pick the character, camera and voice. Once per tablet.
//!   attract    — the face, waiting; the camera looking for a pass.
//!   connecting — a pass was scanned: minting the guest's session.
//!   piloting   — the direct line: the thread, the composer, the countdown.
//!
//! A tap on the wake overlay is the one user gesture the browser needs
//! before the terminal may make a sound unattended.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer, Thread } from "./chat.tsx";
import { baseOf, dropConfig, hintsFromSearch, loadConfig, provision, saveConfig, withoutSecrets, type TerminalConfig } from "./config.ts";
import { Face, type FaceHandle } from "./face/Face.tsx";
import { moodOfText, type Mood } from "./face/mood.ts";
import { useIdleTimeout } from "./idle.ts";
import { beginPilot, endPilot, fetchRoster, tokenAlive, usePilotSession, type Line, type Pilot } from "./pilot.ts";
import { matchName, parseScan } from "./scan.ts";
import { Scanner, type CameraState, cameraProblem } from "./scanner.tsx";
import { BrowserEngine, ServerEngine, SpeechQueue, audioUnlocked, unlock, type SpeechEngine } from "./speech/engine.ts";
import { rankVoices } from "./speech/pick-voice.ts";
import { revealOffsets, splitSentences } from "./speech/split.ts";

type Screen = { kind: "setup"; notice: string | null } | { kind: "attract" } | { kind: "connecting"; id: string } | { kind: "piloting"; pilot: Pilot };

export function App() {
  const [config, setConfig] = useState<TerminalConfig | null>(() => loadConfig());
  const [screen, setScreen] = useState<Screen>(() => (loadConfig() ? { kind: "attract" } : { kind: "setup", notice: null }));
  const [awake, setAwake] = useState(() => audioUnlocked());

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

  const wake = useCallback(() => {
    void unlock().then(() => setAwake(audioUnlocked() || !("AudioContext" in window)));
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

  return (
    <>
      <Terminal
        config={config}
        screen={screen}
        setScreen={setScreen}
        onSetup={() => setScreen({ kind: "setup", notice: null })}
      />
      {!awake && (
        <button className="wake" onClick={wake}>
          <span className="wake-title">TOUCH TO WAKE</span>
          <span className="wake-sub">this terminal needs one touch before it may speak</span>
        </button>
      )}
    </>
  );
}

// --- the running terminal ----------------------------------------------------

function Terminal({ config, screen, setScreen, onSetup }: { config: TerminalConfig; screen: Screen; setScreen: (s: Screen) => void; onSetup: () => void }) {
  const pilot = screen.kind === "piloting" ? screen.pilot : null;
  const session = usePilotSession(config, pilot);
  const [mood, setMood] = useState<Mood>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [flash, setFlash] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [typedOpen, setTypedOpen] = useState(false);
  const [castOnline, setCastOnline] = useState<boolean | null>(null);
  const [engineUsed, setEngineUsed] = useState<SpeechEngine["kind"] | null>(null);
  const face = useRef<FaceHandle | null>(null);
  const offsets = useRef(new Map<number, number[]>());
  const chunkText = useRef(new Map<number, string[]>());

  // --- the voice ---
  const queue = useMemo(() => {
    const browser = BrowserEngine.available() ? new BrowserEngine({ voice: config.browserVoice, speed: config.speed }) : null;
    const server = new ServerEngine({ base: baseOf(config), token: config.token, voice: config.serverVoice, speed: config.speed });
    const engines =
      config.engine === "browser" && browser !== null ? { primary: browser as SpeechEngine, fallback: null } : { primary: server as SpeechEngine, fallback: browser as SpeechEngine | null };
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
  useEffect(() => () => queue.stop(), [queue]);

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

  // While waiting: is the character's agent online? (a mod-only read,
  // polled gently — the status line on the attract screen).
  useEffect(() => {
    if (screen.kind !== "attract") return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`${baseOf(config)}/api/state?role=mod`, { headers: { "x-loom-token": config.token } });
        if (!res.ok) return;
        const view = (await res.json()) as { cast?: Array<{ id: string; online?: boolean }> };
        const me = view.cast?.find((c) => c.id === config.character);
        if (alive) setCastOnline(me?.online ?? null);
      } catch {
        /* the status line just stays blank */
      }
    };
    void poll();
    const t = window.setInterval(() => void poll(), 20_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [screen.kind, config]);

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
          <span className="dot" data-on={String(pilot !== null ? session.connected : castOnline !== null)} />
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
            <button className="link gear" onClick={onSetup} aria-label="Set up this terminal">
              ⚙
            </button>
          )}
        </span>
      </header>

      <main className="stage">
        <section className="face-pane">
          <Face mood={mood} speaking={speaking} handle={face} />
          <div className="nameplate">{config.character.toUpperCase()}</div>
          {engineUsed === "browser" && config.engine !== "browser" && <div className="engine-note">voice: tablet fallback</div>}
        </section>

        <section className="line-pane">
          {screen.kind === "attract" && (
            <div className="attract">
              <div className="scan-frame">
                <Scanner facing={config.camera} active onCode={onCode} onState={setCamera} />
              </div>
              <div className="attract-text">
                <div className="big">SCAN YOUR PASS</div>
                <div className="small">open the app · tap ⚙ · hold your pass to the camera</div>
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

// --- setup -------------------------------------------------------------------

function Setup({ current, notice, onDone, onForget }: { current: TerminalConfig | null; notice: string | null; onDone: (c: TerminalConfig) => void; onForget: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(current?.name ?? "");
  const [character, setCharacter] = useState(current?.character ?? "Trabolta");
  const [camera, setCamera] = useState<TerminalConfig["camera"]>(current?.camera ?? "user");
  const [engine, setEngine] = useState<TerminalConfig["engine"]>(current?.engine ?? "auto");
  const [serverVoice, setServerVoice] = useState(current?.serverVoice ?? "");
  const [browserVoice, setBrowserVoice] = useState(current?.browserVoice ?? "");
  const [speed, setSpeed] = useState(current?.speed ?? 1);
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [serverVoiceInfo, setServerVoiceInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!BrowserEngine.available()) return;
    const load = () => setVoices(rankVoices(speechSynthesis.getVoices()));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  useEffect(() => {
    if (current === null) return;
    void fetch(`${baseOf(current)}/api/mod/tts`, { headers: { "x-loom-token": current.token } })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { available: boolean; voice: string; model: string } | null) => {
        if (info === null) return;
        setServerVoiceInfo(info.available ? `server voice on (${info.model}, default ${info.voice})` : "no server voice configured (LOOM_TTS_URL) — the tablet's own will be used");
      })
      .catch(() => {});
  }, [current]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let next: TerminalConfig;
      if (code.trim() !== "") {
        next = await provision(code.trim(), { name: name.trim() || null, character: character.trim() || null, camera, engine });
      } else if (current !== null) {
        next = { ...current, name: name.trim() || current.name, character: character.trim() || current.character, camera, engine };
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

  const testVoice = async () => {
    await unlock();
    const b = new BrowserEngine({ voice: browserVoice, speed });
    const p = await b.prepare("Connection established. I have been expecting you, program.");
    if (p !== null) void b.play(p, () => {});
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
            <select value={engine} onChange={(e) => setEngine(e.target.value as TerminalConfig["engine"])}>
              <option value="auto">server voice, tablet as fallback</option>
              <option value="server">server voice only</option>
              <option value="browser">tablet voice only</option>
            </select>
          </label>
        </div>
        {serverVoiceInfo && <div className="muted">{serverVoiceInfo}</div>}
        <div className="row">
          <label>
            server voice name <span className="muted">(blank = server default)</span>
            <input value={serverVoice} onChange={(e) => setServerVoice(e.target.value)} placeholder="am_michael · bm_george · af_bella+af_sky" />
          </label>
          <label>
            pace {speed.toFixed(2)}×
            <input type="range" min={0.6} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
        </div>
        <label>
          tablet voice <span className="muted">(best first)</span>
          <span className="row">
            <select value={browserVoice} onChange={(e) => setBrowserVoice(e.target.value)}>
              <option value="">best available{voices[0] ? ` — ${voices[0].name}` : ""}</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang}){v.localService ? "" : " · online"}
                </option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={() => void testVoice()} disabled={voices.length === 0}>
              TEST
            </button>
          </span>
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
          Provision a fleet by opening <code>/terminal/?code=&lt;mod passcode&gt;&amp;name=Kitchen&amp;character=Trabolta</code> on each tablet. The camera needs https:// (or localhost); without it, programs type their name instead.
        </p>
      </form>
    </div>
  );
}
