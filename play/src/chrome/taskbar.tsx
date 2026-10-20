//! The Win95 taskbar (wave 13; the chrome lane finishes it): ⊞ Start, the
//! role's buttons (the guest's 🎟 Pass + 📷 Scan, the booth's big 📷 Scan),
//! and the system tray (the clock, the balance, missed moments) whose
//! leading edge is the live dot. Plumbing's plain, working version, mounted
//! nowhere in Stage A.
//!
//! Width rule: below 400 px wide the buttons are icon-only (the label stays
//! as `aria-label`) except the primary one, and the tray shows at most 3
//! items (`css/chrome.css`).

import { useState, type ReactNode } from "react";

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

export function Taskbar({
  start,
  startHeader,
  buttons,
  tray,
  conn,
}: {
  start: StartItem[];
  /** The Start menu's banner: who you are — name, avatar, faction pill; a booth's admin / host pill. */
  startHeader?: ReactNode;
  buttons: TaskbarButton[];
  tray?: ReactNode;
  /** The tray's leading-edge colour = the live dot (connected / reconnecting / offline). */
  conn?: "live" | "reconnecting" | "offline";
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setAsking(null);
  };
  const pick = (it: StartItem) => {
    if (it.confirm !== undefined && asking !== it.id) return setAsking(it.id);
    close();
    it.onClick();
  };
  return (
    <nav className="taskbar" aria-label="Taskbar">
      <button type="button" className="w95-btn taskbar-btn taskbar-start" aria-expanded={open} aria-haspopup="menu" onClick={() => (open ? close() : setOpen(true))}>
        <span aria-hidden>⊞</span> <span className="taskbar-label">Start</span>
      </button>
      {open && (
        <div className="start-menu" role="menu">
          {startHeader !== undefined && <div className="start-menu-head">{startHeader}</div>}
          {start.map((it) =>
            asking === it.id ? (
              <div key={it.id} className="start-menu-confirm">
                <span>{it.confirm}</span>
                <button type="button" role="menuitem" className={`w95-btn ${it.danger ? "danger" : ""}`} onClick={() => pick(it)}>
                  {it.label}
                </button>
                <button type="button" className="w95-btn" onClick={() => setAsking(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button key={it.id} type="button" role="menuitem" className={`start-menu-item ${it.danger ? "danger" : ""}`} onClick={() => pick(it)}>
                {it.icon !== undefined && <span aria-hidden>{it.icon}</span>}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`w95-btn taskbar-btn ${b.primary ? "primary" : ""}`}
          aria-label={b.label}
          aria-pressed={b.active === undefined ? undefined : b.active}
          title={b.title ?? b.label}
          data-tour={b.tour}
          onClick={b.onClick}
        >
          <span aria-hidden>{b.icon}</span>
          <span className="taskbar-label">{b.label}</span>
          {b.badge !== undefined && b.badge > 0 && <span className="taskbar-badge">{b.badge > 9 ? "9+" : b.badge}</span>}
        </button>
      ))}
      {tray !== undefined && <div className={`taskbar-tray ${conn ?? ""}`}>{tray}</div>}
    </nav>
  );
}

/** One tray item (a clock, a balance, a count): a ≥ 44 px tall tap target when `onClick`. */
export function TrayItem({ icon, text, title, onClick, tone }: { icon?: string; text: string; title?: string; onClick?: () => void; tone?: "alarm" | "dim" }) {
  const body = (
    <>
      {icon !== undefined && <span aria-hidden>{icon}</span>}
      <span>{text}</span>
    </>
  );
  if (onClick === undefined) {
    return (
      <span className={`tray-item ${tone ?? ""}`} title={title}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" className={`tray-item ${tone ?? ""}`} title={title} onClick={onClick}>
      {body}
    </button>
  );
}
