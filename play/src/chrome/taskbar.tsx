//! The Win95 taskbar (wave 13): the bottom edge of every screen. ⊞ Start
//! (the menu: who you are, settings, help, people, the story's own buttons,
//! leave), the role's buttons (the guest's 🎟 Pass + 📷 Scan, the booth's
//! big 📷 Scan), and the system tray at the right (the clock, the balance,
//! missed moments) whose leading edge is the live dot.
//!
//! It is a flex item at the foot of `.app-frame`, never `position: fixed`
//! (the host dock stacks above it with no measuring), and it owns the
//! bottom safe-area inset. Width rule: below 400 px the buttons are
//! icon-only (the label stays as `aria-label`) except the primary one, and
//! the tray shows at most 3 items (`css/chrome.css`).
//!
//! A button the current objective names (`active`) asks for attention the
//! way a Win95 window did: its taskbar button turns caption-blue (it blinks
//! twice on arrival, still under reduced motion).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { eventRoot } from "./balloon.tsx";

export interface StartItem {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
  /** Ask first ("Leave the event?") — the menu confirms in place. */
  confirm?: string;
}

export interface TaskbarButton {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
  /** The role's main button (the booth's 📷 Scan, the guest's 🎟 Pass): wider, keeps its label at any width. */
  primary?: boolean;
  badge?: number;
  title?: string;
  /** `data-tour` anchor. */
  tour?: string;
  active?: boolean;
}

/** The Start menu's next state after a tap on `item` while `asking` holds
 *  the item awaiting its confirmation (pure — `test/start-menu.test.tsx`):
 *  an item with a `confirm` asks first; a second tap on the same item fires
 *  it; anything else fires at once. */
export function startTap(asking: string | null, item: Pick<StartItem, "id" | "confirm">): { asking: string | null; fire: boolean } {
  if (item.confirm !== undefined && asking !== item.id) return { asking: item.id, fire: false };
  return { asking: null, fire: true };
}

/** A taskbar button's classes (the order the tests and the CSS read). */
export function taskbarButtonClass(b: Pick<TaskbarButton, "primary" | "active">): string {
  return `w95-btn taskbar-btn${b.primary ? " primary" : ""}${b.active ? " attn" : ""}`;
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
  const [asking, setAsking] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const startBtn = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setAsking(null);
  };
  const pick = (it: StartItem) => {
    const next = startTap(asking, it);
    if (!next.fire) return setAsking(next.asking);
    close();
    it.onClick();
  };
  // Opened: focus the first item; Escape closes and hands focus back to Start.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const key = (e: Event) => {
      if ((e as KeyboardEvent).key !== "Escape") return;
      setOpen(false);
      setAsking(null);
      startBtn.current?.focus();
    };
    const root = eventRoot(startBtn.current);
    root.addEventListener("keydown", key);
    return () => root.removeEventListener("keydown", key);
  }, [open]);
  const connWord = conn === "live" ? "live" : conn === "reconnecting" ? "reconnecting…" : conn === "offline" ? "offline" : undefined;
  return (
    <nav className="taskbar" aria-label="Taskbar">
      <button
        ref={startBtn}
        type="button"
        className={`w95-btn taskbar-btn taskbar-start${open ? " open" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        data-tour="start"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="taskbar-icon" aria-hidden>
          ⊞
        </span>
        <span className="taskbar-label">Start</span>
      </button>
      {open && <div className="start-menu-away" aria-hidden onClick={close} />}
      {open && (
        <div ref={menu} className="start-menu" role="menu" aria-label="Start">
          {brand !== undefined && (
            <div className="start-menu-band" aria-hidden>
              <span>{brand}</span>
            </div>
          )}
          <div className="start-menu-items">
            {startHeader !== undefined && <div className="start-menu-head">{startHeader}</div>}
            {start.map((it) =>
              asking === it.id ? (
                <div key={it.id} className="start-menu-confirm" role="group" aria-label={it.confirm}>
                  <span className="start-menu-ask">{it.confirm}</span>
                  <div className="start-menu-confirm-row">
                    <button type="button" role="menuitem" className={`w95-btn${it.danger ? " danger" : ""}`} onClick={() => pick(it)}>
                      {it.label}
                    </button>
                    <button type="button" className="w95-btn" onClick={() => setAsking(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button key={it.id} type="button" role="menuitem" className={`start-menu-item${it.danger ? " danger" : ""}`} onClick={() => pick(it)}>
                  <span className="start-menu-icon" aria-hidden>
                    {it.icon ?? ""}
                  </span>
                  <span className="start-menu-label">{it.label}</span>
                </button>
              ),
            )}
          </div>
        </div>
      )}
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={taskbarButtonClass(b)}
          aria-label={b.label}
          title={b.title ?? b.label}
          data-tour={b.tour}
          onClick={b.onClick}
        >
          <span className="taskbar-icon" aria-hidden>
            {b.icon}
          </span>
          <span className="taskbar-label">{b.label}</span>
          {b.badge !== undefined && b.badge > 0 && <span className="taskbar-badge">{b.badge > 9 ? "9+" : b.badge}</span>}
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
export function TrayItem({ icon, text, title, onClick, tone, tour }: { icon?: string; text: string; title?: string; onClick?: () => void; tone?: "alarm" | "dim"; tour?: string }) {
  const body = (
    <>
      {icon !== undefined && <span aria-hidden>{icon}</span>}
      <span>{text}</span>
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
