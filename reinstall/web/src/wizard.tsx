//! Windows 98 chrome for the menus — the "Reinstallation Wizard": a window
//! with a gradient title bar, the classic setup-wizard layout (a banner
//! panel on the left, the step on the right, `< Back` / `Next >` along the
//! bottom), and a segmented progress bar. Pure presentation.

import type { ReactNode } from "react";

export function Window({
  title,
  icon = "💿",
  className,
  onClose,
  children,
}: {
  title: string;
  icon?: string;
  className?: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`w98-window${className ? ` ${className}` : ""}`} role="dialog" aria-label={title}>
      <header className="w98-title">
        <span className="w98-title-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="w98-title-text">{title}</span>
        <span className="w98-title-buttons" aria-hidden={onClose === undefined}>
          <span className="w98-tb">_</span>
          <span className="w98-tb">□</span>
          {onClose !== undefined ? (
            <button className="w98-tb close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          ) : (
            <span className="w98-tb">✕</span>
          )}
        </span>
      </header>
      <div className="w98-body">{children}</div>
    </section>
  );
}

/** The setup-wizard body: the banner on the left, the step on the right. */
export function Wizard({ step, total, heading, children, actions, banner }: { step?: number; total?: number; heading: string; children: ReactNode; actions?: ReactNode; banner?: ReactNode }) {
  return (
    <div className="wizard">
      <aside className="wizard-banner" aria-hidden="true">
        {banner ?? <DuckBanner />}
      </aside>
      <div className="wizard-main">
        {step !== undefined && total !== undefined && (
          <div className="wizard-step">
            Step {step} of {total}
          </div>
        )}
        <h1 className="wizard-heading">{heading}</h1>
        <div className="wizard-content">{children}</div>
      </div>
      {actions !== undefined && <footer className="wizard-actions">{actions}</footer>}
    </div>
  );
}

/** The banner art: a CD, a gilded duck, the wordmark — all CSS. */
export function DuckBanner() {
  return (
    <div className="banner-art">
      <div className="banner-cd" />
      <div className="banner-duck">
        <span className="bd-body" />
        <span className="bd-head" />
        <span className="bd-bill" />
        <span className="bd-eye" />
      </div>
      <div className="banner-word">
        Reinstall
        <br />
        <b>98</b>
      </div>
    </div>
  );
}

/** A Win98 segmented progress bar, `value` 0…1. */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const blocks = 20;
  const on = Math.round(Math.max(0, Math.min(1, value)) * blocks);
  return (
    <div className="w98-progress-wrap">
      {label !== undefined && <div className="w98-progress-label">{label}</div>}
      <div className="w98-progress w98-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        {Array.from({ length: blocks }, (_, i) => (
          <span key={i} className={i < on ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}

/** The Windows desktop behind the menus (taskbar + clock). */
export function Desktop({ children, status }: { children: ReactNode; status?: ReactNode }) {
  return (
    <div className="desktop">
      <div className="desktop-stage">{children}</div>
      <footer className="taskbar">
        <span className="start w98-button">
          <b>⊞</b> Start
        </span>
        <span className="task w98-sunken">💿 Reinstallation Wizard</span>
        <span className="tray w98-sunken">{status}</span>
      </footer>
    </div>
  );
}
