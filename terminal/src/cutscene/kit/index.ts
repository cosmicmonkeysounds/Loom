//! The cutscene kit (wave 17): the building blocks every act's scenes are
//! made of. Each is drawn from `t` (ms into the scene) — pure position from
//! time — so a reload resumes and every screen in the house is in step.
//! The look is the terminal's own: Win98 silver and navy for the chrome,
//! VT323 phosphor for the machine's voice (`kit.css`).

import "./kit.css";

export { Bsod, Glitch, Hourglass, Noise, Spotlight, type SpotFrame } from "./effects.tsx";
export { Confetti, Particles, Starfield } from "./canvas-fx.tsx";
export { PopupStorm, STORM_MESSAGES, type StormMessage } from "./storm.tsx";
export { BigNumber, Countdown, Marquee, Typewriter } from "./text.tsx";
export { Desktop, ProgressBar, Taskbar, Win98Button, Win98Dialog, Win98Icon, Win98Window, openStyle, type DesktopIcon, type DialogProps, type IconKind, type Len, type WinProps } from "./win98.tsx";
export { useCues, useSfxCues, type Cue } from "./cues.ts";
export { CONFETTI_COLORS, MAX_PARTICLES, confettiEmitters, particlesAt, starsAt, type Emitter, type Particle, type ParticleShape } from "./physics.ts";
export * from "./time.ts";

export { Stage } from "./stage.tsx";
