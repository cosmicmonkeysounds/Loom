// The Win95 taskbar (wave 13): the bottom edge of every screen. ⊞ Start
// (the menu: who you are, settings, help, people, the story's own buttons,
// leave), the role's buttons (the guest's 🎟 Pass + 📷 Scan, the booth's
// big 📷 Scan), and the system tray at the right (the clock, the balance,
// missed moments) whose leading edge is the live dot.
//
// It is a flex item at the foot of `.app-frame`, never `position: fixed`
// (the host dock stacks above it with no measuring), and it owns the
// bottom safe-area inset. Width rule: below 400 px the buttons are
// icon-only (the label stays as `aria-label`) except the primary one, and
// the tray shows at most 3 items (`css/chrome.css`).
//
// A button the current objective names (`active`) asks for attention the
// way a Win95 window did: its taskbar button turns caption-blue (it blinks
// twice on arrival, still under reduced motion).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { eventRoot } from "./balloon.tsx";
import { Icon } from "./icons.tsx";
import { StartMenu, type StartItem } from "./start-menu.tsx";

export type { StartItem } from "./start-menu.tsx";
export { startTap } from "./start-menu.tsx";

export interface TaskbarButton {
  id: string;
  label: string;
  /** A drawn icon (`chrome/icons.tsx`); a string still renders as text. */
  icon: ReactNode;
  onClick: () => void;
  /** The role's main button (the booth's 📷 Scan, the guest's 🎟 Pass): wider, keeps its label at any width. */
  primary?: boolean;
  /** Keeps its word on a narrow phone too (the guest's Scan, next to Pass). */
  labelled?: boolean;
  badge?: number;
  title?: string;
  /** `data-tour` anchor. */
  tour?: string;
  active?: boolean;
  /** The window on screen (wave 18: the guest's Mission / Chats): sunken, `aria-pressed`. */
  pressed?: boolean;
  /** The icon over its word, 56 px tall, the word kept at every width (the guest's bar). */
  stacked?: boolean;
  /** A yellow dot, never a number (the guest's Chats). */
  dot?: boolean;
  /** A short mark in the corner (Mission's "!" when the objective changed). */
  mark?: string;
}

/** A taskbar button's classes (the order the tests and the CSS read). */
export function taskbarButtonClass(b: Pick<TaskbarButton, "primary" | "active" | "labelled"> & Partial<Pick<TaskbarButton, "pressed" | "stacked">>): string {
  return `w95-btn taskbar-btn${b.primary ? " primary" : ""}${b.labelled ? " labelled" : ""}${b.stacked ? " stacked" : ""}${b.pressed ? " pressed" : ""}${b.active ? " attn" : ""}`;
}

export function Taskbar({
  start,
  startHeader,
  buttons,
  tray,
  conn,
  brand,
}: {
  start: StartItem[];
  /** The Start menu's banner: who you are — name, avatar, faction pill; a booth's admin / host pill. */
  startHeader?: ReactNode;
  buttons: TaskbarButton[];
  tray?: ReactNode;
  /** The tray's leading-edge colour = the live dot (connected / reconnecting / offline). */
  conn?: "live" | "reconnecting" | "offline";
  /** The word up the Start menu's side band (the story's title); aol97 only. */
  brand?: string;
}) {
  const [open, setOpen] = useState(false);
  const startBtn = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  // Open: Escape closes and hands focus back to Start.
  useEffect(() => {
    if (!open) return;
    const key = (e: Event) => {
      if ((e as KeyboardEvent).key !== "Escape") return;
      setOpen(false);
      startBtn.current?.focus();
    };
    const root = eventRoot(startBtn.current);
    root.addEventListener("keydown", key);
    return () => root.removeEventListener("keydown", key);
  }, [open]);
  const connWord = conn === "live" ? "live" : conn === "reconnecting" ? "reconnecting…" : conn === "offline" ? "offline" : undefined;
  return (
    <nav className={`taskbar${open ? " start-open" : ""}`} aria-label="Taskbar">
      <button
        ref={startBtn}
        type="button"
        className={`w95-btn taskbar-btn taskbar-start${open ? " open" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Start"
        data-tour="start"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="taskbar-icon" aria-hidden>
          <Icon name="start" />
        </span>
        <span className="taskbar-label">Start</span>
      </button>
      {open && <div className="start-menu-away" aria-hidden onClick={close} />}
      {open && <StartMenu items={start} header={startHeader} brand={brand} onClose={close} />}
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={taskbarButtonClass(b)}
          aria-label={b.dot === true ? `${b.label}, something new` : b.label}
          aria-pressed={b.pressed === undefined ? undefined : b.pressed}
          title={b.title ?? b.label}
          data-tour={b.tour}
          onClick={() => {
            // A taskbar button works with the Start menu open: one tap closes it and does its job.
            if (open) close();
            b.onClick();
          }}
        >
          <span className="taskbar-icon" aria-hidden>
            {b.icon}
          </span>
          <span className="taskbar-label">{b.label}</span>
          {b.badge !== undefined && b.badge > 0 && <span className="taskbar-badge">{b.badge > 9 ? "9+" : b.badge}</span>}
          {b.dot === true && <span className="taskbar-dot" aria-hidden />}
          {b.mark !== undefined && b.mark !== "" && (
            <span className="taskbar-mark" aria-hidden>
              {b.mark}
            </span>
          )}
        </button>
      ))}
      {tray !== undefined && (
        <div className={`taskbar-tray ${conn ?? ""}`} title={connWord} aria-label={connWord !== undefined ? `Tray — ${connWord}` : "Tray"} role="group">
          {tray}
        </div>
      )}
    </nav>
  );
}

/** One tray item (a clock, a balance, a count): a ≥ 44 px tall tap target when `onClick`. */
export function TrayItem({ icon, text, tail, title, onClick, tone, tour }: { icon?: ReactNode; text: string; /** Words a narrow tray may drop (the clock's AM / PM). */ tail?: string; title?: string; onClick?: () => void; tone?: "alarm" | "dim"; tour?: string }) {
  const body = (
    <>
      {icon !== undefined && (
        <span className="tray-ico" aria-hidden>
          {icon}
        </span>
      )}
      <span>
        {text}
        {tail !== undefined && <span className="tray-tail">{tail}</span>}
      </span>
    </>
  );
  if (onClick === undefined) {
    return (
      <span className={`tray-item ${tone ?? ""}`} title={title} data-tour={tour}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" className={`tray-item ${tone ?? ""}`} title={title} aria-label={title} data-tour={tour} onClick={onClick}>
      {body}
    </button>
  );
}
