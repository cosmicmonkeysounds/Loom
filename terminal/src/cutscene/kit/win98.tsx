//! The Win98 chrome every scene is made of (wave 17): windows, dialogs,
//! buttons, the icons, the progress bar, the teal desktop and its taskbar —
//! the same silver bevels and navy title bars as the slide cards
//! (`styles.css` `.slide-window`), drawn bigger and alive. Drag-free and
//! inert: a scene is watched, not used (a `×` may take `onClose` where a
//! screen wants a tap).

import type { CSSProperties, ReactNode } from "react";
import { clamp01, ease } from "./time.ts";

/** A length: a number is a share of the parent (%), a string any CSS length. */
export type Len = number | string;
const len = (v: Len | undefined): string | undefined => (v === undefined ? undefined : typeof v === "number" ? `${v}%` : v);

// --- icons ------------------------------------------------------------------------------

export type IconKind = "error" | "warning" | "info" | "question" | "computer" | "document" | "folder" | "globe" | "trash" | "mail" | "duck" | "lock";

/** A 32-px Win98-style icon (original vector art), scaled by `size` (CSS length). */
export function Win98Icon({ kind, size = "2em", className }: { kind: IconKind; size?: string; className?: string }) {
  return (
    <svg className={`kit-icon${className ? ` ${className}` : ""}`} viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" shapeRendering="crispEdges">
      {ICONS[kind]}
    </svg>
  );
}

const ICONS: Record<IconKind, ReactNode> = {
  error: (
    <>
      <circle cx="16" cy="16" r="14" fill="#ff0000" stroke="#800000" strokeWidth="1.5" />
      <path d="M10 10 L22 22 M22 10 L10 22" stroke="#fff" strokeWidth="3.5" strokeLinecap="square" />
    </>
  ),
  warning: (
    <>
      <path d="M16 2 L31 29 L1 29 Z" fill="#ffff00" stroke="#000" strokeWidth="1.5" strokeLinejoin="miter" />
      <rect x="14.5" y="10" width="3" height="11" fill="#000" />
      <rect x="14.5" y="23" width="3" height="3" fill="#000" />
    </>
  ),
  info: (
    <>
      <path d="M4 4 H28 V22 H14 L8 28 V22 H4 Z" fill="#fff" stroke="#000" strokeWidth="1.5" />
      <rect x="14.5" y="7" width="3" height="3" fill="#0000ff" />
      <rect x="14.5" y="11.5" width="3" height="8" fill="#0000ff" />
    </>
  ),
  question: (
    <>
      <path d="M4 4 H28 V22 H14 L8 28 V22 H4 Z" fill="#fff" stroke="#000" strokeWidth="1.5" />
      <path d="M12 10 Q12 6.5 16 6.5 Q20 6.5 20 10 Q20 12.5 16.5 13.5 V16" fill="none" stroke="#0000ff" strokeWidth="2.6" />
      <rect x="15" y="17.5" width="3" height="3" fill="#0000ff" />
    </>
  ),
  computer: (
    <>
      <rect x="4" y="3" width="24" height="18" fill="#c0c0c0" stroke="#000" />
      <rect x="7" y="6" width="18" height="12" fill="#008080" />
      <rect x="7" y="6" width="18" height="3" fill="#000080" />
      <rect x="10" y="21" width="12" height="3" fill="#808080" />
      <rect x="3" y="24" width="26" height="5" fill="#c0c0c0" stroke="#000" />
      <rect x="22" y="26" width="4" height="1.5" fill="#00a000" />
    </>
  ),
  document: (
    <>
      <path d="M7 2 H21 L26 7 V30 H7 Z" fill="#fff" stroke="#000" />
      <path d="M21 2 V7 H26" fill="#c0c0c0" stroke="#000" />
      {[11, 14, 17, 20, 23].map((y) => (
        <rect key={y} x="10" y={y} width="13" height="1.4" fill="#000080" />
      ))}
    </>
  ),
  folder: (
    <>
      <path d="M2 8 H12 L14 5 H22 V8 H30 V27 H2 Z" fill="#ffd84d" stroke="#806000" />
      <path d="M2 12 H30" stroke="#806000" />
    </>
  ),
  globe: (
    <>
      <circle cx="16" cy="16" r="13" fill="#3a6eea" stroke="#000" />
      <path d="M9 8 Q13 10 12 14 Q9 16 11 20 Q14 22 13 26 M20 6 Q23 9 21 12 Q24 15 27 14 M18 19 Q22 20 23 24" fill="none" stroke="#3ddc54" strokeWidth="3" />
      <ellipse cx="16" cy="16" rx="6" ry="13" fill="none" stroke="#fff" strokeOpacity="0.45" />
      <path d="M3 16 H29" stroke="#fff" strokeOpacity="0.45" />
    </>
  ),
  trash: (
    <>
      <path d="M8 9 H24 L22 30 H10 Z" fill="#d0d0d0" stroke="#000" />
      <rect x="6" y="6" width="20" height="3" fill="#a0a0a0" stroke="#000" />
      <path d="M12 12 L13 27 M16 12 V27 M20 12 L19 27" stroke="#606060" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="7" width="26" height="18" fill="#fff" stroke="#000" />
      <path d="M3 7 L16 18 L29 7" fill="none" stroke="#000" />
      <rect x="22" y="9" width="5" height="5" fill="#ff4040" />
    </>
  ),
  duck: (
    <>
      <ellipse cx="17" cy="21" rx="11" ry="7" fill="#ffc83d" stroke="#8a6200" />
      <circle cx="10.5" cy="12" r="6" fill="#ffc83d" stroke="#8a6200" />
      <path d="M4 12.5 L0.5 14 L4.5 15.2 Z" fill="#ff8a00" stroke="#8a4000" />
      <circle cx="9.5" cy="10.8" r="1.2" fill="#000" />
      <path d="M17 18 Q22 15 26 19" fill="none" stroke="#8a6200" />
    </>
  ),
  lock: (
    <>
      <path d="M10 14 V9 Q10 4 16 4 Q22 4 22 9 V14" fill="none" stroke="#606060" strokeWidth="3" />
      <rect x="6" y="14" width="20" height="15" fill="#ffd84d" stroke="#806000" />
      <rect x="15" y="19" width="2.5" height="6" fill="#806000" />
    </>
  ),
};

// --- windows ------------------------------------------------------------------------------

export interface WinProps {
  title: ReactNode;
  icon?: IconKind;
  /** Where its top-left sits (a number: % of the parent). Leave both out for normal flow. */
  x?: Len;
  y?: Len;
  /** Centre on (x, y) instead of hanging from it. */
  center?: boolean;
  width?: Len;
  height?: Len;
  /** 0 → 1: the window popping open (overshoots a little; under reduced motion it only fades). */
  open?: number;
  /** A grey title bar: not the window in front. */
  inactive?: boolean;
  /** Which title-bar buttons (default: close only, like a dialog). */
  buttons?: ReadonlyArray<"min" | "max" | "close">;
  /** A status bar under the body. */
  status?: ReactNode;
  /** The title bar's colour: the classic navy, or a red / green / purple for drama. */
  tone?: "navy" | "red" | "green" | "purple" | "black";
  reduced?: boolean;
  onClose?: () => void;
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
  zIndex?: number;
  children?: ReactNode;
}

/** The transform + opacity of a popping window at `open` (0..1). */
export function openStyle(open: number, reduced: boolean, center: boolean): { transform: string; opacity: number } {
  const k = clamp01(open);
  const base = center ? "translate(-50%, -50%) " : "";
  if (reduced) return { transform: base || "none", opacity: k };
  const s = 0.55 + 0.45 * ease.outBack(k);
  return { transform: `${base}scale(${s.toFixed(4)})`, opacity: clamp01(k * 2.5) };
}

export function Win98Window({ title, icon, x, y, center = false, width, height, open = 1, inactive = false, buttons = ["close"], status, tone = "navy", reduced = false, onClose, className, bodyClassName, style, zIndex, children }: WinProps) {
  if (open <= 0) return null;
  const placed = x !== undefined || y !== undefined;
  const anim = openStyle(open, reduced, center);
  return (
    <div
      className={`kit-win${inactive ? " kit-win-inactive" : ""} kit-tone-${tone}${className ? ` ${className}` : ""}`}
      role="dialog"
      style={{ position: placed ? "absolute" : undefined, left: len(x), top: len(y), width: len(width), height: len(height), zIndex, transform: anim.transform, opacity: anim.opacity, ...style }}
    >
      <div className="kit-titlebar">
        <span className="kit-title">
          {icon !== undefined && <Win98Icon kind={icon} size="1.05em" />}
          <span className="kit-title-text">{title}</span>
        </span>
        <span className="kit-tb-buttons">
          {buttons.map((b) => (
            <span key={b} className={`kit-tb-btn kit-tb-${b}`} onClick={b === "close" ? onClose : undefined} role={b === "close" && onClose ? "button" : undefined}>
              <TitleGlyph kind={b} />
            </span>
          ))}
        </span>
      </div>
      <div className={`kit-win-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
      {status !== undefined && <div className="kit-statusbar">{status}</div>}
    </div>
  );
}

function TitleGlyph({ kind }: { kind: "min" | "max" | "close" }) {
  return (
    <svg viewBox="0 0 8 7" aria-hidden="true" shapeRendering="crispEdges">
      {kind === "min" && <rect x="1" y="5" width="5" height="2" fill="#000" />}
      {kind === "max" && <path d="M0.5 0.5 H7.5 V6.5 H0.5 Z M0.5 1.5 H7.5" fill="none" stroke="#000" />}
      {kind === "close" && <path d="M1 0.5 L7 6.5 M7 0.5 L1 6.5" stroke="#000" strokeWidth="1.4" />}
    </svg>
  );
}

/** A raised Win98 button (`pressed`: sunk; `primary`: the default, with its black rim). */
export function Win98Button({ children, pressed = false, primary = false, className, onClick }: { children: ReactNode; pressed?: boolean; primary?: boolean; className?: string; onClick?: () => void }) {
  return (
    <span className={`kit-btn${pressed ? " kit-btn-pressed" : ""}${primary ? " kit-btn-primary" : ""}${className ? ` ${className}` : ""}`} onClick={onClick} role={onClick ? "button" : undefined}>
      {children}
    </span>
  );
}

export interface DialogProps extends Omit<WinProps, "children"> {
  message: ReactNode;
  kind?: Extract<IconKind, "error" | "warning" | "info" | "question">;
  /** Button labels (default OK); `pressed` sinks one (a click on the beat). */
  actions?: readonly string[];
  pressed?: number;
}

/** A message box: the icon, the words, the buttons. */
export function Win98Dialog({ message, kind = "error", actions = ["OK"], pressed, ...win }: DialogProps) {
  return (
    <Win98Window {...win} bodyClassName="kit-dialog">
      <div className="kit-dialog-row">
        <Win98Icon kind={kind} size="2.2em" />
        <div className="kit-dialog-text">{message}</div>
      </div>
      <div className="kit-dialog-actions">
        {actions.map((a, i) => (
          <Win98Button key={a} primary={i === 0} pressed={pressed === i}>
            {a}
          </Win98Button>
        ))}
      </div>
    </Win98Window>
  );
}

/** The segmented progress bar (`value` 0..1), with an optional label and percent. */
export function ProgressBar({ value, segments = 24, label, percent = false, className, style }: { value: number; segments?: number; label?: ReactNode; percent?: boolean; className?: string; style?: CSSProperties }) {
  const v = clamp01(value);
  const lit = Math.floor(v * segments + 1e-9);
  return (
    <div className={`kit-progress-wrap${className ? ` ${className}` : ""}`} style={style}>
      {label !== undefined && <div className="kit-progress-label">{label}</div>}
      <div className="kit-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className={`kit-seg${i < lit ? " on" : ""}`} />
        ))}
      </div>
      {percent && <div className="kit-progress-pct">{Math.floor(v * 100)}% complete</div>}
    </div>
  );
}

// --- the desktop ------------------------------------------------------------------------------

export interface DesktopIcon {
  label: string;
  kind: IconKind;
}

/** The teal desktop, full size: icons down the left, the taskbar along the bottom, whatever the scene puts on it in between. */
export function Desktop({ icons = [], taskbar = true, clock = "12:00 AM", tasks = [], start = false, bg = "#008080", className, children }: { icons?: readonly DesktopIcon[]; taskbar?: boolean; clock?: string; tasks?: readonly string[]; start?: boolean; bg?: string; className?: string; children?: ReactNode }) {
  return (
    <div className={`kit-desktop${className ? ` ${className}` : ""}`} style={{ background: bg }}>
      <div className="kit-desk-icons">
        {icons.map((i) => (
          <div key={i.label} className="kit-desk-icon">
            <Win98Icon kind={i.kind} size="2.4em" />
            <span>{i.label}</span>
          </div>
        ))}
      </div>
      <div className="kit-desk-space">{children}</div>
      {taskbar && <Taskbar clock={clock} tasks={tasks} start={start} />}
    </div>
  );
}

/** The taskbar: the Start button (pressed while `start`), a button per task, the tray clock. */
export function Taskbar({ clock, tasks = [], start = false }: { clock: string; tasks?: readonly string[]; start?: boolean }) {
  return (
    <div className="kit-taskbar">
      <span className={`kit-btn kit-start${start ? " kit-btn-pressed" : ""}`}>
        <StartFlag />
        <b>Start</b>
      </span>
      <span className="kit-tasks">
        {tasks.map((t, i) => (
          <span key={`${t}${i}`} className={`kit-btn kit-task${i === tasks.length - 1 ? " kit-btn-pressed" : ""}`}>
            {t}
          </span>
        ))}
      </span>
      <span className="kit-tray">{clock}</span>
    </div>
  );
}

/** A four-pane waving flag (original), the Start button's mark. */
function StartFlag() {
  return (
    <svg viewBox="0 0 16 14" className="kit-flag" aria-hidden="true">
      <path d="M1 2 Q4 1 7 2 V7 Q4 6 1 7 Z" fill="#ff2a2a" />
      <path d="M8.5 2.3 Q11.5 3.3 15 2.3 V7.3 Q11.5 8.3 8.5 7.3 Z" fill="#2ac93c" />
      <path d="M1 8 Q4 7 7 8 V13 Q4 12 1 13 Z" fill="#2a6dff" />
      <path d="M8.5 8.3 Q11.5 9.3 15 8.3 V13.3 Q11.5 14.3 8.5 13.3 Z" fill="#ffd21f" />
    </svg>
  );
}
