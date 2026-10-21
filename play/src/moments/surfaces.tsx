//! The moments' surfaces (wave 13, the moments lane): each rung of the
//! interrupt ladder is the Win95 part that does that job — a system-tray
//! balloon tip, a sticky notification bar, a modal message box with OK, the
//! blue screen — plus the quiet feedback toast and the glitch that plays
//! when the story changes the level. Plain markup over `w95-*` primitives
//! and lane classes (`moments-…`), every colour from a token, so `plain`
//! renders the same structure flat.
//!
//! Wave 18: every rung renders its exits (`exits.ts`: a balloon 1, the
//! others 2) beside its own close; no Dismiss all anywhere; the blue
//! screen's fatal-exception boilerplate only on the sign-in's first. The
//! big moment is `big.tsx`.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Icon } from "../chrome/icons.tsx";
import { usePlayHost } from "../host.ts";
import { WinDialog } from "../ui/window.tsx";
import type { Exit } from "./exits.ts";
import { faultAddress, type Moment, type Queued } from "./model.ts";

/** Taps this soon after a modal appears are ignored (a tap meant for the app underneath). */
export const MODAL_DEAD_MS = 400;

type IconKind = "error" | "warning" | "info";

/** Which Win95 icon a moment carries — the way Win95 told severity, by the
 *  box's icon, never its title bar, and never by the rung it sits on (a
 *  notice raised to a dialog is still a notice): the red stop only for a
 *  major `!` alarm; the yellow warning for any other major message (a
 *  readout that matters, a `reply` to you); information for a notice — a
 *  card that asks, a quest, an objective, a beat's line — and for anything
 *  minor (a booth's demoted guest alarm too). */
export function iconOf(m: Pick<Moment, "severity"> & Partial<Pick<Moment, "kind" | "alarm">>): IconKind {
  if (m.severity !== "major" && m.severity !== "big") return "info";
  if (m.kind === "alert" || m.alarm === true) return "error";
  if (m.kind === "card" || m.kind === "quest" || m.kind === "objective" || m.kind === "beat") return "info";
  return "warning";
}

/** The Win95 message-box icons, drawn (32 × 32 grid). */
export function MomentIcon({ kind, size = 32 }: { kind: IconKind; size?: number }) {
  return (
    <svg className={`moments-ico moments-ico-${kind}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      {kind === "error" && (
        <>
          <circle className="moments-ico-stop" cx="16" cy="16" r="13.5" />
          <path className="moments-ico-cross" d="M10.6 8.5 16 13.9l5.4-5.4 2.1 2.1-5.4 5.4 5.4 5.4-2.1 2.1-5.4-5.4-5.4 5.4-2.1-2.1 5.4-5.4-5.4-5.4Z" />
        </>
      )}
      {kind === "warning" && (
        <>
          <path className="moments-ico-warn" d="M16 2.5 30.5 28.5H1.5Z" />
          <rect className="moments-ico-mark" x="14.4" y="10" width="3.2" height="10.5" />
          <rect className="moments-ico-mark" x="14.4" y="22.6" width="3.2" height="3.2" />
        </>
      )}
      {kind === "info" && (
        <>
          <path className="moments-ico-bubble" d="M16 2.5c7.2 0 12.5 4.9 12.5 11.2S23.2 25 16 25c-1 0-2-.1-3-.3L6.5 29.5l1.8-6.2C5.2 21.3 3.5 17.8 3.5 13.7 3.5 7.4 8.8 2.5 16 2.5Z" />
          <rect className="moments-ico-i" x="14.3" y="6.4" width="3.4" height="3.4" />
          <rect className="moments-ico-i" x="14.3" y="11.6" width="3.4" height="9.4" />
        </>
      )}
    </svg>
  );
}

/** A moment's body: an objective's title in bold over its brief, else the text. */
function MomentText({ m, className }: { m: Moment; className: string }) {
  if (m.kind === "objective") {
    const [title, ...rest] = m.text.split("\n");
    return (
      <div className={className}>
        <strong className="moments-objective-title">{title}</strong>
        {rest.length > 0 && <span className="moments-objective-brief">{rest.join("\n")}</span>}
      </div>
    );
  }
  return <div className={className}>{m.text}</div>;
}

/** A moment's exit buttons (its own close stays separate). */
export function ExitButtons({ exits, onExit, className, guard }: { exits: readonly Exit[]; onExit: (e: Exit) => void; className: string; guard?: (fn: () => void) => () => void }) {
  return (
    <>
      {exits.map((x) => (
        <button key={`${x.nav.to}:${x.label}`} type="button" className={className} onClick={(guard ?? ((fn) => fn))(() => onExit(x))}>
          {x.icon !== null && <Icon name={x.icon} size={16} />}
          <span className="moments-exit-label">{x.label}</span>
        </button>
      ))}
    </>
  );
}

/** Ignore taps for the first `MODAL_DEAD_MS` (a modal never eats a tap meant for what was under it). */
function useDeadTime(): () => boolean {
  const since = useRef(Date.now());
  return () => Date.now() - since.current >= MODAL_DEAD_MS;
}

// --- balloon ------------------------------------------------------------------

/** The system-tray balloon tip: bottom-right, its tail on the tray, times out (provider). */
export function Balloon({ q, exits, onExit, onDismiss }: { q: Queued; exits: readonly Exit[]; onExit: (e: Exit) => void; onDismiss: () => void }) {
  const m = q.moment;
  return (
    <div className={`moments-balloon ${m.severity}`} role={m.severity === "minor" ? "status" : "alert"} aria-live={m.severity === "minor" ? "polite" : "assertive"}>
      <div className="moments-balloon-head">
        <MomentIcon kind={iconOf(m)} size={18} />
        <span className="moments-balloon-caption">{m.caption}</span>
        <button type="button" className="moments-balloon-x" aria-label="Close" onClick={onDismiss}>
          <span aria-hidden>×</span>
        </button>
      </div>
      <MomentText m={m} className="moments-balloon-text" />
      <ExitButtons exits={exits.slice(0, 1)} onExit={onExit} className="moments-balloon-go" />
    </div>
  );
}

// --- sticky -------------------------------------------------------------------

/** Who a sticky names before its words ("Trabolta: …", "New quest: …"),
 *  or null when the icon already says what it is (an announcement, a
 *  message, an objective's own title). Never a caption above the text. */
export function stickyLead(m: Pick<Moment, "caption" | "kind">): string | null {
  if (m.kind === "objective") return null;
  const c = m.caption.trim();
  return c === "" || c === "Announcement" || c === "Message" ? null : c;
}

/** A sticky's words show at most this many lines, then "more ›" (finish review #2). */
export const STICKY_LINES = 3;
/** Before the first measure (and in a server render): a text this long is taken as clipped. */
export const STICKY_MORE_CHARS = 150;

/** useLayoutEffect in a browser (no flash of "more ›"), useEffect in the tests' server render. */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** The sticky notification bar: under the title bar, in flow, until tapped.
 *  A `!` alarm is the full-yellow bar; anything else the info-tip yellow
 *  with a dark frame. Its words stop at three lines with "more ›" (a quest
 *  brief ran to 12 lines, 550 px of an 844 px phone). Its exits (≤ 2) and ×;
 *  never a Dismiss all (G6). `count` is how many wait (the screen reader's). */
export function StickyBanner({ q, count, exits, onExit, onDismiss }: { q: Queued; count: number; exits: readonly Exit[]; onExit: (e: Exit) => void; onDismiss: () => void }) {
  const m = q.moment;
  const lead = stickyLead(m);
  const alarm = m.severity === "major" && m.kind === "alert";
  const words = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(() => m.text.length > STICKY_MORE_CHARS);
  // Measure the clamped words: "more ›" only when lines were cut.
  useIsoLayoutEffect(() => {
    const el = words.current;
    if (el === null || open) return;
    setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [m.text, open]);
  return (
    <div className={`moments-sticky ${m.severity}${alarm ? " alarm" : ""}`} role={m.severity === "minor" ? "status" : "alert"} data-waiting={count}>
      <button type="button" className="moments-sticky-body" onClick={onDismiss} aria-label={`${lead !== null ? `${lead}: ` : ""}${m.text}. Tap to dismiss.`}>
        <span className="moments-sticky-icon">
          <MomentIcon kind={iconOf(m)} size={24} />
        </span>
        <span ref={words} className={`moments-sticky-words${open ? "" : " clamp"}`}>
          {m.kind === "objective" ? (
            <MomentText m={m} className="moments-sticky-text" />
          ) : (
            <span className="moments-sticky-text">
              {lead !== null && <strong className="moments-sticky-lead">{lead}: </strong>}
              {m.text}
            </span>
          )}
        </span>
      </button>
      <span className="moments-sticky-actions">
        {(clipped || open) && (
          <button type="button" className="w95-btn moments-sticky-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Less ▴" : "more ›"}
          </button>
        )}
        <ExitButtons exits={exits.slice(0, 2)} onExit={onExit} className="w95-btn moments-go" />
        <button type="button" className="w95-btn moments-sticky-x" aria-label="Dismiss" onClick={onDismiss}>
          <span aria-hidden>×</span>
        </button>
      </span>
    </div>
  );
}

// --- dialog -------------------------------------------------------------------

/** The modal message box: caption, icon, text, its exits (≤ 2), OK (focused), "1 of 3". */
export function MomentDialog({ q, index, total, exits, onExit, onDismiss }: { q: Queued; index: number; total: number; exits: readonly Exit[]; onExit: (e: Exit) => void; onDismiss: () => void }) {
  const m = q.moment;
  const ok = useRef<HTMLButtonElement>(null);
  const live = useDeadTime();
  // WinDialog focuses its first control (the caption's ×); a message box's default is OK.
  useEffect(() => {
    const t = window.setTimeout(() => ok.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  const guard = (fn: () => void) => () => {
    if (live()) fn();
  };
  return (
    // Severity is the box's icon (the red stop for a `!` alarm), never a
    // recoloured title bar: Win95's message boxes all wore the navy caption.
    <WinDialog title={m.caption} onClose={guard(onDismiss)} label={`${m.caption}: ${m.text}`}>
      <div className="moments-dialog">
        <div className="moments-dialog-row">
          <MomentIcon kind={iconOf(m)} />
          <MomentText m={m} className="moments-dialog-text" />
        </div>
        <div className="moments-dialog-foot">
          <span className="moments-dialog-left">
            {total > 1 && (
              <span className="moments-dialog-count w95-inset" aria-label={`Message ${index} of ${total}`}>
                {index} of {total}
              </span>
            )}
          </span>
          <span className="moments-dialog-buttons">
            <ExitButtons exits={exits.slice(0, 2)} onExit={onExit} className="w95-btn moments-go" guard={guard} />
            <button ref={ok} type="button" className="w95-btn moments-ok" onClick={guard(onDismiss)}>
              OK
            </button>
          </span>
        </div>
      </div>
    </WinDialog>
  );
}

// --- blue screen ----------------------------------------------------------------

/** Does this pane wear the Win95 skin (`aol97`)? Unknown (no page) → yes. */
function useWin95(): boolean {
  const root = usePlayHost().themeRoot();
  return root === null || root.dataset["theme"] === "aol97";
}

/** The blue screen: the whole phone, white on blue, "Press any key to
 *  continue". Under `plain` the same full-screen frame with neutral copy:
 *  no fault address, no "Press any key", just "Tap to continue". Wave 18:
 *  the fatal-exception boilerplate only when `boilerplate` (the sign-in's
 *  first blue screen); a later one leads with ANNOUNCEMENT and the text. */
export function BlueScreen({
  q,
  index,
  total,
  exits,
  onExit,
  onDismiss,
  win95: forced,
  boilerplate = true,
}: {
  q: Queued;
  index: number;
  total: number;
  exits: readonly Exit[];
  onExit: (e: Exit) => void;
  onDismiss: () => void;
  win95?: boolean;
  boilerplate?: boolean;
}) {
  const m = q.moment;
  const skinned = useWin95();
  const win95 = forced ?? skinned;
  const box = useRef<HTMLDivElement>(null);
  const live = useDeadTime();
  useEffect(() => {
    const before = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    box.current?.focus();
    return () => before?.focus?.();
  }, []);
  const onClick = () => {
    if (live()) onDismiss();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      // The stops: the screen, then its exits, round again.
      e.preventDefault();
      const stops: HTMLElement[] = [...(box.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      if (box.current) stops.unshift(box.current);
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = stops[(at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length];
      next?.focus();
      return;
    }
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    if ((e.target as HTMLElement).tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
    e.preventDefault();
    if (live()) onDismiss();
  };
  const go = (x: Exit) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (live()) onExit(x);
  };
  const shown = exits.slice(0, 2);
  const buttons = shown.map((x) => (
    <button key={`${x.nav.to}:${x.label}`} type="button" className="moments-bsod-go" onClick={go(x)}>
      {x.label}
    </button>
  ));
  const head = !boilerplate ? "ANNOUNCEMENT" : win95 ? (m.caption || "Windows").toUpperCase() : m.caption || "Important";
  return (
    <div ref={box} className="moments-bsod" role="alertdialog" aria-modal="true" aria-labelledby="moments-bsod-head" aria-describedby="moments-bsod-text" tabIndex={-1} onClick={onClick} onKeyDown={onKey}>
      <div className="moments-bsod-inner">
        <div className="moments-bsod-headrow">
          <span id="moments-bsod-head" className="moments-bsod-head">
            {head}
          </span>
          {total > 1 && (
            <span className="moments-bsod-count">
              {index} of {total}
            </span>
          )}
        </div>
        {win95 && boilerplate && (
          <p className="moments-bsod-fault">
            A fatal exception 0E has occurred at {faultAddress(m.key)}. The current program has stopped to show you this:
          </p>
        )}
        <MomentText m={m} className="moments-bsod-text" />
        {win95 ? (
          <ul className="moments-bsod-list">
            <li>Tap anywhere to continue.</li>
            {buttons.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : (
          buttons.length > 0 && <p className="moments-bsod-plain-go">{buttons}</p>
        )}
        <p id="moments-bsod-text" className="moments-bsod-press">
          {win95 ? (
            <>
              Press any key to continue <span className="moments-bsod-caret" aria-hidden>_</span>
            </>
          ) : (
            "Tap to continue"
          )}
        </p>
      </div>
    </div>
  );
}

// --- toast + glitch ----------------------------------------------------------------

/** The quiet feedback toast (✔ Done, a refusal): a status strip, never an alarm. */
export function Toast({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <button type="button" className="moments-toast" role="status" onClick={onDismiss} aria-label={`${text}. Tap to dismiss.`}>
      {text}
    </button>
  );
}

/** The level-change glitch: its own overlay, never a filter on the app. */
export function Glitch() {
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
  }, []);
  return <div className={`moments-glitch ${still ? "still" : ""}`} aria-hidden />;
}
