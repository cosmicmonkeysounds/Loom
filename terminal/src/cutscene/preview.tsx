//! The cutscene preview (wave 17) — for the lanes and the reviewers, in
//! Chrome, with no server: `?preview=list` lists every scene (the four act
//! files and the kit demo) beside a device frame and a scrubber;
//! `?preview=<sceneId>&t=<ms>` draws one scene at one moment, full page
//! (`&play=1` runs it from there). Open in dev (`pnpm --filter
//! loom-terminal dev`, :5175), or on a provisioned terminal (a stored mod
//! config): `main.tsx` decides.
//!
//! The list drives the single view inside an iframe sized to the device
//! (so `vw` / `vh` / `vmin` mean what they mean on that screen), sending it
//! `t` and play / pause by `postMessage`. Options ride the iframe's URL:
//! `target=tv|wall`, `intro=0` (before the introduction), `reduced=1`,
//! `who=<name>`, `value=<slide value>` (an `award_*` family), `phase=`,
//! `countdown=<s>` (a running countdown, counting down with `t`),
//! `beats=<Beat>@<ms>,…` (house-wide beat moments that many ms after the
//! scene started: `beats=The Bag Of Truth@20000`), `world=1` (a world view
//! is on this screen: the duck's see-through take), `results=auto|none|read|
//! verdict` (wave 18b: a made-up results block — `auto` gives the reading
//! scenes theirs: question `results_q` for hunt_results, H4–H6 for the
//! tally, the verdict for The Verdict), `rows=<n>` (filings per question).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./kit/kit.css";
import "./cutscene.css";
import "./preview.css";
import { sfx } from "../sound/bus.ts";
import { audioUnlocked, unlock } from "../speech/engine.ts";
import { SceneStage } from "./CutsceneLayer.tsx";
import { useReducedMotion } from "./clock.ts";
import { fakeResults, fakeState } from "./fake.ts";
import { introduced } from "./pick.ts";
import { noteWorldShowing } from "./world-bus.ts";
import { ACTS } from "./registry.ts";
import { DEMO_SCENES } from "./scenes/demo.tsx";
import type { SceneDef, SceneTarget } from "./types.ts";
import type { ScreenMoment } from "../screen.ts";

/** Every scene the preview knows, grouped by file (the demo last). */
const GROUPS: ReadonlyArray<{ file: string; scenes: readonly SceneDef[] }> = [...ACTS, { file: "demo (preview only)", scenes: DEMO_SCENES }];
const ALL: readonly SceneDef[] = GROUPS.flatMap((g) => g.scenes);

/** A "hold" scene scrubs over this long. */
const HOLD_SCRUB_MS = 60_000;
/** The fake moment's / slide's `at`: 23:45 on 31/12/1999 (UTC), for anything that shows a time. */
const AT = 946_684_800_000 - 15 * 60_000;

const DEVICES = [
  { id: "tv", label: "TV 1920×1080", w: 1920, h: 1080, target: "tv" as SceneTarget },
  { id: "tablet", label: "tablet 1280×800", w: 1280, h: 800, target: "wall" as SceneTarget },
  { id: "old", label: "old tablet 1024×768", w: 1024, h: 768, target: "wall" as SceneTarget },
  { id: "portrait", label: "portrait 800×1280", w: 800, h: 1280, target: "wall" as SceneTarget },
];

export function lengthOf(def: SceneDef): number {
  return typeof def.ms === "number" ? def.ms : HOLD_SCRUB_MS;
}

/** `beats=Name@ms,…` → the beat moments already played by `t` (each `ms` after the scene's `at`). */
export function previewBeats(spec: string, t: number): ScreenMoment[] {
  const out: ScreenMoment[] = [];
  spec.split(",").forEach((part, i) => {
    const m = /^(.+)@(\d+)$/u.exec(part.trim());
    if (m === null || Number(m[2]) > t) return;
    out.push({ seq: 100 + i, at: AT + Number(m[2]), kind: "beat", name: m[1]!.trim(), who: null, kept: false });
  });
  return out;
}

/** What a scene's first trigger says it was started by. */
export function triggerValue(def: SceneDef): string {
  const w = def.when[0];
  if (w === undefined) return def.id;
  if ("slide" in w) return w.slide.replace(/\*$/u, "");
  if ("room" in w) return w.room;
  return w.name;
}

function triggerText(def: SceneDef): string {
  return def.when.map((w) => ("slide" in w ? `slide ${w.slide}` : "room" in w ? `room cue room_${w.room}` : `${w.moment} "${w.name}"`)).join(" · ");
}

export function Preview() {
  const q = new URLSearchParams(window.location.search);
  const id = q.get("preview") ?? "list";
  if (id === "list") return <PreviewList />;
  return <PreviewOne id={id} q={q} />;
}

// --- one scene, full page ------------------------------------------------------------

function PreviewOne({ id, q }: { id: string; q: URLSearchParams }) {
  const def = ALL.find((d) => d.id === id) ?? null;
  const embed = q.get("embed") === "1";
  const [t, setT] = useState(() => Math.max(0, Number(q.get("t") ?? "0") || 0));
  const [playing, setPlaying] = useState(q.get("play") === "1");
  const [speed, setSpeed] = useState(1);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const [sound, setSound] = useState(() => audioUnlocked());
  const systemReduced = useReducedMotion();
  const reduced = q.get("reduced") === "1" || systemReduced;
  const target: SceneTarget = q.get("target") === "wall" ? "wall" : "tv";
  // The parent list drives t and play.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; t?: number; playing?: boolean; speed?: number } | null;
      if (e.origin !== window.location.origin || d === null || d.type !== "loom-preview") return;
      if (typeof d.t === "number") setT(d.t);
      if (typeof d.playing === "boolean") setPlaying(d.playing);
      if (typeof d.speed === "number") setSpeed(d.speed);
    };
    window.addEventListener("message", on);
    window.parent.postMessage({ type: "loom-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", on);
  }, []);
  // Standalone `&play=1`: its own clock.
  useEffect(() => {
    if (!playing || embed) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      setT((x) => x + (now - last) * speed);
      last = now;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, embed, speed]);
  const countdown = q.get("countdown");
  const phase = q.get("phase");
  const intro = q.get("intro") !== "0";
  const nightQ = q.get("night");
  const beats = q.get("beats") ?? "";
  const resultsQ = q.get("results") ?? "auto";
  const rowsQ = q.get("rows");
  // `world=1`: before the scene mounts, as a world view would be.
  const [world] = useState(() => (q.get("world") === "1" ? noteWorldShowing() : null));
  useEffect(() => () => world?.(), [world]);
  const state = useMemo(() => {
    const night: Record<string, string | number | boolean | null> = { ...nightParam(nightQ), ...(phase !== null ? { phase } : {}) };
    const results = previewResults(id, resultsQ, target, rowsQ === null ? 12 : Math.max(0, Number(rowsQ) || 0), night);
    if (results !== null && id === "hunt_results" && night["results_q"] === undefined) night["results_q"] = results.questions[0]?.n ?? 1;
    return fakeState({
      now: AT + t,
      introduced: intro,
      target: target === "tv" ? "tv" : "terminals",
      night,
      countdown: countdown !== null ? "y2k" : null,
      remaining: countdown !== null ? Math.max(0, Number(countdown) - Math.floor(t / 1000)) : null,
      moments: previewBeats(beats, t),
      results,
    });
  }, [t, target, countdown, phase, intro, nightQ, beats, id, resultsQ, rowsQ]);
  if (def === null) return <div className="pv-missing">No scene called “{id}”. Try ?preview=list.</div>;
  const blocked = def.namesCharacter === true && !introduced(state);
  // Scrubbing is silent: sounds only while it plays.
  const play = playing ? sfx : () => false;
  return (
    <div className="pv-one">
      {blocked ? (
        <div className="pv-missing">“{def.id}” names the character: before the introduction it never plays (the slide shows its card).</div>
      ) : (
        <SceneStage def={def} kind={def.when.some((w) => "slide" in w) ? "slide" : "moment"} target={target} t={t} at={AT} seq={1} value={q.get("value") ?? triggerValue(def)} who={q.get("who") ?? "Winamp"} state={state} reduced={reduced} play={play} onDone={() => setDoneAt((d) => d ?? t)} />
      )}
      {!embed && (
        <div className="pv-hud">
          {def.id} · t = {(t / 1000).toFixed(2)} s{doneAt !== null ? ` · done() at ${(doneAt / 1000).toFixed(2)} s` : ""}
        </div>
      )}
      {!sound && (
        <button
          type="button"
          className="pv-sound"
          onClick={() => {
            void unlock().then(() => setSound(audioUnlocked()));
          }}
        >
          🔊 sound
        </button>
      )}
    </div>
  );
}

// --- the list: every scene, a device frame, a scrubber -----------------------------------

function PreviewList() {
  const [id, setId] = useState(() => (ALL.find((d) => d.id === "demo") ?? ALL[0])?.id ?? "");
  const [device, setDevice] = useState(DEVICES[0]!);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [intro, setIntro] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [who, setWho] = useState("Winamp");
  const [phase, setPhase] = useState("");
  const [countdown, setCountdown] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 960, h: 540 });
  const def = ALL.find((d) => d.id === id) ?? null;
  const len = def === null ? 0 : lengthOf(def);

  // Fit the device into the stage area.
  useEffect(() => {
    const el = area.current;
    if (el === null) return;
    // The area's box less its 16 px padding each side.
    const measure = () => setBox({ w: Math.max(1, el.clientWidth - 32), h: Math.max(1, el.clientHeight - 32) });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const scale = Math.min(box.w / device.w, box.h / device.h, 1);

  const post = useCallback((msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ type: "loom-preview", ...msg }, window.location.origin), []);
  // The frame (re)loaded: tell it where we are.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin === window.location.origin && (e.data as { type?: string } | null)?.type === "loom-preview-ready") post({ t: tRef.current, playing: playRef.current, speed });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [post, speed]);
  const tRef = useRef(t);
  tRef.current = t;
  const playRef = useRef(playing);
  playRef.current = playing;

  // Play: advance t here, the frame follows.
  useEffect(() => {
    if (!playing) {
      post({ playing: false, t: tRef.current });
      return;
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const next = tRef.current + (now - last) * speed;
      last = now;
      const wrapped = next > len + 1500 ? 0 : next; // loop the scene with a beat of rest
      setT(wrapped);
      post({ t: wrapped, playing: true, speed });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, len, post]);
  const seek = (v: number) => {
    const x = Math.max(0, Math.min(len, Math.round(v)));
    setT(x);
    post({ t: x });
  };

  const target = device.target;
  const params = new URLSearchParams({ preview: id, embed: "1", target });
  if (!intro) params.set("intro", "0");
  if (reduced) params.set("reduced", "1");
  if (who.trim() !== "") params.set("who", who.trim());
  if (phase.trim() !== "") params.set("phase", phase.trim());
  if (countdown.trim() !== "") params.set("countdown", countdown.trim());
  const src = `${window.location.pathname}?${params.toString()}`;
  const single = new URLSearchParams(params);
  single.delete("embed");
  single.set("t", String(Math.round(t)));

  return (
    <div className="pv">
      <aside className="pv-side">
        <h1>CUTSCENES</h1>
        {GROUPS.map((g) => (
          <section key={g.file}>
            <h2>{g.file}</h2>
            {g.scenes.length === 0 && <div className="pv-empty">no scenes yet</div>}
            {g.scenes.map((d) => (
              <button
                type="button"
                key={d.id}
                className={`pv-pick${d.id === id ? " on" : ""}`}
                onClick={() => {
                  setId(d.id);
                  setT(0);
                }}
              >
                <span className="pv-pick-id">{d.id}</span>
                <span className="pv-pick-when">{triggerText(d)}</span>
                <span className="pv-pick-meta">
                  {typeof d.ms === "number" ? `${(d.ms / 1000).toFixed(1)} s` : "hold"}
                  {d.tv !== undefined ? " · tv" : ""}
                  {d.wall !== undefined ? " · wall" : ""}
                  {d.namesCharacter === true ? " · names him" : ""}
                  {d.face !== undefined ? ` · face ${d.face}` : ""}
                </span>
              </button>
            ))}
          </section>
        ))}
      </aside>
      <main className="pv-main">
        <div className="pv-bar">
          <select value={device.id} onChange={(e) => setDevice(DEVICES.find((d) => d.id === e.target.value) ?? DEVICES[0]!)}>
            {DEVICES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.target})
              </option>
            ))}
          </select>
          <label>
            <input type="checkbox" checked={intro} onChange={(e) => setIntro(e.target.checked)} /> introduced
          </label>
          <label>
            <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> reduced motion
          </label>
          <label>
            who <input value={who} onChange={(e) => setWho(e.target.value)} size={10} />
          </label>
          <label>
            phase <input value={phase} onChange={(e) => setPhase(e.target.value)} size={8} placeholder="desktop" />
          </label>
          <label>
            countdown s <input value={countdown} onChange={(e) => setCountdown(e.target.value)} size={4} placeholder="—" />
          </label>
        </div>
        <div className="pv-area" ref={area}>
          {def === null ? (
            <div className="pv-empty">No scenes yet.</div>
          ) : (
            <div className="pv-device" style={{ width: device.w * scale, height: device.h * scale }}>
              <iframe ref={frame} key={src} title={`${id} preview`} src={src} style={{ width: device.w, height: device.h, transform: `scale(${scale})` }} />
            </div>
          )}
        </div>
        <div className="pv-transport">
          <button type="button" onClick={() => setPlaying((p) => !p)}>
            {playing ? "⏸ pause" : "▶ play"}
          </button>
          <button type="button" onClick={() => seek(0)}>
            ⏮
          </button>
          <button type="button" onClick={() => seek(t - 1000)}>
            −1 s
          </button>
          <button type="button" onClick={() => seek(t - 100)}>
            −0.1
          </button>
          <button type="button" onClick={() => seek(t + 100)}>
            +0.1
          </button>
          <button type="button" onClick={() => seek(t + 1000)}>
            +1 s
          </button>
          <input className="pv-scrub" type="range" min={0} max={Math.max(1, len)} step={10} value={Math.min(t, len)} onChange={(e) => seek(Number(e.target.value))} />
          <span className="pv-time">
            {(t / 1000).toFixed(2)} / {(len / 1000).toFixed(1)} s
          </span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[0.25, 0.5, 1, 2].map((s) => (
              <option key={s} value={s}>
                ×{s}
              </option>
            ))}
          </select>
          <a className="pv-link" href={`${window.location.pathname}?${single.toString()}`} target="_blank" rel="noreferrer">
            open at this t ↗
          </a>
        </div>
      </main>
    </div>
  );
}

/** The preview's made-up results block (`results=`): `auto` gives each reading scene its own. */
export function previewResults(id: string, mode: string, target: SceneTarget, rows: number, night: Record<string, string | number | boolean | null>) {
  const tv = target === "tv";
  const auto = mode === "auto";
  if (mode === "none") return null;
  if (mode === "verdict" || (auto && id === "verdict")) return fakeResults("verdict", { tv });
  if (mode === "read" || (auto && id === "hunt_results")) {
    const n = typeof night["results_q"] === "number" && night["results_q"] >= 1 ? night["results_q"] : 1;
    return fakeResults("read", { ns: [n], rows, tv });
  }
  if (auto && id === "round_two_tally") return fakeResults("read", { ns: [4, 5, 6], rows: Math.min(rows, 6), tv });
  return null;
}

/** `&night=scenario:1,collection_complete:true,ended:false`: night vars for the fake state. */
function nightParam(raw: string | null): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const pair of (raw ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i <= 0) continue;
    const v = pair.slice(i + 1);
    out[pair.slice(0, i)] = v === "true" ? true : v === "false" ? false : v === "null" ? null : /^-?\d+(\.\d+)?$/u.test(v) ? Number(v) : v;
  }
  return out;
}
