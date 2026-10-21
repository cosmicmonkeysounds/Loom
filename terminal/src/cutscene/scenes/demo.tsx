//! The kit's demo (wave 17) — the preview's only (`?preview=demo`), never
//! the show's: one 24 s scene that runs most of the kit through a
//! multi-phase timeline, to prove the engine and to set the bar for the act
//! lanes. Read it as the pattern: one `t`, phases as windows of it, every
//! piece placed and eased from that `t`, sounds on the beat (`useSfxCues`),
//! a lighter wall take sharing the same parts.
//!
//!   0–3 s     power on: stars warp, the prompt types
//!   3–8 s     the desktop: an install with a lurching bar, an ad marquee
//!   8–12 s    the popup storm, the title tears, static creeps in
//!   12–14.5 s the blue screen
//!   14.5–18.5 a spotlight finds a number counting up, a drumroll, a boom
//!   18.5–24 s confetti, the verdict, a countdown to close

import "./demo.css";
import type { SceneDef, SceneProps } from "../types.ts";
import {
  BigNumber,
  Bsod,
  Confetti,
  Countdown,
  Desktop,
  Glitch,
  Hourglass,
  Marquee,
  Noise,
  Particles,
  PopupStorm,
  ProgressBar,
  Spotlight,
  Stage,
  Starfield,
  Typewriter,
  Win98Dialog,
  Win98Window,
  between,
  ease,
  eased,
  fakeProgress,
  lerp,
  progress,
  useSfxCues,
  type Emitter,
} from "../kit/index.ts";

/** The phases, ms into the scene. */
const P = { desk: 3000, storm: 8000, bsod: 12000, reveal: 14500, finale: 18500, end: 24000 } as const;

const FILES = ["DUCK.DLL", "QUACK.VXD", "BREAD.INI", "POND.SYS", "FEATHERS.CAB", "GERALD.EXE"];

const SPARKS: Emitter[] = [
  { x: 0.5, y: 0.52, start: P.reveal + 2100, end: P.reveal + 2300, rate: 600, life: 1400, speed: 0.75, speedJitter: 0.6, angle: -90, spread: 360, gravity: 0.6, drag: 0.6, size: 7, colors: ["#ffd23f", "#fff2b0", "#ff9f1c"], shape: "spark", seed: 11 },
  { x: 0.5, y: 0.52, start: P.reveal + 2100, end: P.reveal + 2200, rate: 300, life: 1800, speed: 0.45, angle: -90, spread: 360, gravity: 0.3, drag: 0.4, size: 12, colors: ["#ffd23f", "#ffffff"], shape: "star", seed: 12 },
];

function KitDemo({ t, who, sfx, reduced, target }: SceneProps) {
  const lite = target === "wall";
  useSfxCues(t, sfx, [
    [200, "startup"],
    [P.desk + 300, "popup"],
    [P.storm - 400, "click"],
    [P.storm - 300, "chord"],
    [P.storm + 2500, "glitch"],
    [P.storm + 3400, "static", { gain: 0.6 }],
    [P.bsod, "critical"],
    [P.reveal + 500, "drumroll"],
    [P.reveal + 2100, "boom"],
    [P.finale, "tada"],
    [P.finale + 250, "fanfare"],
    [P.finale + 2500, "tick"],
    [P.finale + 3500, "tick"],
    [P.finale + 4500, "tick"],
    [P.end - 400, "close"],
  ]);
  const name = who ?? "WINAMP";
  return (
    <Stage bg="#000">
      {t < P.desk + 500 && <PowerOn t={t} lite={lite} reduced={reduced} />}
      {between(t, P.desk, P.bsod) && <DeskPhase t={t} lite={lite} reduced={reduced} sfx={sfx} />}
      {between(t, P.bsod, P.reveal) && <Bsod t={t} start={P.bsod} lines={BSOD} cps={160} />}
      {between(t, P.reveal, P.end + 1000) && <Reveal t={t} lite={lite} reduced={reduced} name={name} />}
    </Stage>
  );
}

const BSOD = [
  "A fatal exception 0E has occurred at 0028:C001D0C5 in VXD KIT(01) +",
  "00010E36. The current application will be terminated.",
  "",
  "*  Press any key to terminate the current application.",
  "*  Press CTRL+ALT+DEL again to restart your computer. You will",
  "   lose any unsaved information in all applications.",
];

/** 0–3 s: the stars speed up into a warp while the prompt types; the desktop fades in over the last half second. */
function PowerOn({ t, lite, reduced }: { t: number; lite: boolean; reduced: boolean }) {
  const speed = lerp(0.08, 1.4, eased(t, 600, 2400, ease.inCubic));
  const warp = reduced ? 0 : eased(t, 1500, 1400, ease.inQuad);
  const out = 1 - progress(t, P.desk, 500);
  return (
    <div className="kit-fill" style={{ opacity: out }}>
      {!lite && <Starfield t={t} speed={reduced ? 0.08 : speed} warp={warp} count={260} />}
      <div className="demo-prompt">
        <Typewriter text={"C:\\> RUN KITDEMO.EXE"} t={t} start={300} cps={22} reserve={false} />
        <br />
        <Typewriter text="LOADING THE KIT…" t={t} start={1500} cps={30} caret={t > 1500} reserve={false} />
      </div>
    </div>
  );
}

/** 3–12 s: the install, the ad, then everything goes wrong. */
function DeskPhase({ t, lite, reduced, sfx }: { t: number; lite: boolean; reduced: boolean; sfx: SceneProps["sfx"] }) {
  const local = t - P.desk;
  const bar = fakeProgress(local - 400, 4100, 7);
  const file = FILES[Math.min(FILES.length - 1, Math.floor(bar * FILES.length))]!;
  const done = bar >= 1;
  const overload = progress(t, P.storm + 2400, 1400);
  const hh = Math.floor((t / 1000) % 60);
  return (
    <div className="kit-fill" style={{ opacity: progress(t, P.desk, 400) }}>
      <Desktop
        icons={[
          { label: "My Computer", kind: "computer" },
          { label: "Recycle Bin", kind: "trash" },
          { label: "The Internet", kind: "globe" },
          { label: "Inbox", kind: "mail" },
          { label: "Duck.exe", kind: "duck" },
        ]}
        tasks={["Netscape", "Setup"]}
        clock={`11:${String(58 + Math.floor(hh / 30)).padStart(2, "0")} PM`}
      >
        <Win98Window title="Netscape — A Special Offer" icon="globe" x={22} y={5} width="66%" open={eased(t, P.desk + 900, 260, ease.linear)} buttons={["min", "max", "close"]} inactive reduced={reduced}>
          <Marquee t={t} speed={180} className="demo-marquee">
            ★ CONGRATULATIONS! YOU ARE THE 1,000,000th VISITOR ★ CLICK HERE TO CLAIM YOUR FREE DUCK ★ THIS IS NOT A SCAM ★
          </Marquee>
        </Win98Window>
        <Win98Window title="Setup" icon="computer" x={50} y={56} center width="min(64%, 30em)" open={eased(t, P.desk + 300, 240, ease.linear)} status={done ? "Ready" : `Copying ${file}…`} reduced={reduced}>
          <div className="demo-setup">
            <Hourglass t={t} size="3.2em" />
            <div className="demo-setup-text">
              <b>Installing the Kit</b>
              <div className="demo-small">{done ? "Setup has finished copying files." : `Copying ${file} to C:\\KIT`}</div>
              <ProgressBar value={bar} percent />
            </div>
          </div>
          <div className="demo-actions">
            <span className={`kit-btn kit-btn-primary${between(t, P.storm - 400, P.storm - 200) ? " kit-btn-pressed" : ""}`} style={{ opacity: done ? 1 : 0.5 }}>
              Finish
            </span>
          </div>
        </Win98Window>
        {t >= P.storm && <PopupStorm t={t} seed={3} count={lite ? 10 : 18} start={P.storm} span={3200} sfx={sfx} reduced={reduced} width={lite ? "44%" : "32%"} />}
        {t >= P.storm + 2400 && (
          <div className="demo-overload" style={{ opacity: Math.min(1, overload * 3) }}>
            <Glitch t={t} intensity={reduced ? 0 : 0.25 + overload * 0.6} seed={5} reduced={reduced}>
              <span className="demo-overload-text">SYSTEM OVERLOAD</span>
            </Glitch>
          </div>
        )}
      </Desktop>
      {!lite && t >= P.storm + 2000 && <Noise t={t} alpha={0.08 + 0.32 * progress(t, P.storm + 2000, 2000)} reduced={reduced} />}
    </div>
  );
}

/** 14.5–24 s: dark, a spotlight finds the count, it lands with a boom, then the finale. */
function Reveal({ t, lite, reduced, name }: { t: number; lite: boolean; reduced: boolean; name: string }) {
  const finale = t >= P.finale;
  const closing = P.end - t;
  return (
    <div className="kit-fill demo-reveal" style={{ opacity: progress(t, P.reveal, 600) * (1 - progress(t, P.end, 600)) }}>
      <div className="demo-count">
        <div className="demo-count-label">FUN DETECTED</div>
        <BigNumber t={t} to={1_000_000} start={P.reveal + 500} dur={1600} />
      </div>
      {!finale && (
        <Spotlight
          t={t}
          frames={
            reduced
              ? [{ t: P.reveal, x: 50, y: 52, r: 30 }]
              : [
                  { t: P.reveal, x: 18, y: 30, r: 14 },
                  { t: P.reveal + 900, x: 80, y: 40, r: 14 },
                  { t: P.reveal + 1700, x: 50, y: 52, r: 24 },
                  { t: P.reveal + 2400, x: 50, y: 52, r: 60 },
                ]
          }
        />
      )}
      {!lite && !reduced && <Particles t={t} emitters={SPARKS} blend="add" />}
      {finale && (
        <>
          <Confetti t={t} start={P.finale} dur={4200} density={lite ? 0.5 : 1} seed={4} />
          <Win98Dialog
            title="Kit Self-Test"
            kind="info"
            x={50}
            y={76}
            center
            width="min(80%, 26em)"
            open={eased(t, P.finale + 300, 260, ease.linear)}
            message={
              <>
                All building blocks passed.
                <br />
                <b>{name.toUpperCase()}</b> wins a duck.
              </>
            }
            actions={["OK"]}
            pressed={closing < 500 ? 0 : undefined}
            reduced={reduced}
          />
          <div className="demo-close">
            <Countdown ms={Math.max(0, closing)} warn={6000} label="CLOSING IN" reduced={reduced} />
          </div>
        </>
      )}
    </div>
  );
}

export const DEMO_SCENES: SceneDef[] = [
  {
    id: "demo",
    when: [{ slide: "kit_demo" }, { moment: "signal", name: "kit demo" }],
    ms: P.end + 600,
    tv: KitDemo,
    wall: KitDemo,
    face: "glitch",
  },
];
