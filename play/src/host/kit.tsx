//! The host panel's small parts (wave 13): the drawer's shared context (the
//! view, the calls, a feedback line), a button that asks before it does
//! anything that can't be taken back, and a section heading.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ApiError } from "../client.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { HostView } from "../types.ts";
import type { HostCalls } from "./api.ts";
import type { HostTab, MoreFocus } from "./model.ts";

export interface HostCtx {
  view: HostView;
  calls: HostCalls;
  session: PrimeSession;
  /** Wall ms, ticking once a second while the drawer is open. */
  now: number;
  /** Run one write: a feedback line on success (`done`) or the server's
   *  refusal, then a fresh poll. Resolves true when it went through. */
  run: (done: string, call: () => Promise<unknown> | null) => Promise<boolean>;
  /** Move the drawer to a tab (and a More section). */
  go: (tab: HostTab, section?: MoreFocus | null) => void;
  /** Close the drawer and open a room (the staff room). */
  openRoom: (channel: string) => void;
  /** Close the drawer and open a guest's card in the booth. */
  openCard: (guestId: string) => void;
}

export const HostContext = createContext<HostCtx | null>(null);

export function useHost(): HostCtx {
  const c = useContext(HostContext);
  if (c === null) throw new Error("useHost outside the host drawer");
  return c;
}

/** The feedback line for a failed write. */
export function failText(e: unknown): string {
  if (e instanceof ApiError) return `Not done — ${e.message}`;
  return `Not sure it went through — ${e instanceof Error ? e.message : String(e)}`;
}

/** Bring an ask that just opened into view inside the console's scroll
 *  body: a confirm under the last rows (the alert dial's Switch / No at
 *  390 px) opened below the fold, behind the NEXT bar, and read as a tap
 *  that did nothing. */
export function useRevealed(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, ref]);
}

/**
 * A button that asks first: the first tap turns it into "<ask> Yes / No"
 * in place (no modal over the drawer), the second does it. Used for every
 * action that can't be taken back (release a part, restrict a guest, send
 * to every phone, switch the alert level, the King, the stimulus).
 */
export function ConfirmButton({ label, ask, yes = "Yes", onConfirm, danger, disabled, className, testId }: { label: ReactNode; ask: string; yes?: string; onConfirm: () => Promise<unknown> | void; danger?: boolean; disabled?: boolean; className?: string; testId?: string }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useRevealed(box, asking);
  if (asking) {
    return (
      <span className="host-confirm" role="group" aria-label={ask} ref={box}>
        <span className="host-confirm-ask">{ask}</span>
        <button
          type="button"
          className={`w95-btn host-confirm-yes ${danger ? "danger" : ""}`}
          disabled={busy}
          data-testid={testId !== undefined ? `${testId}-yes` : undefined}
          onClick={() => {
            setBusy(true);
            void Promise.resolve(onConfirm()).finally(() => {
              setBusy(false);
              setAsking(false);
            });
          }}
        >
          {busy ? "…" : yes}
        </button>
        <button type="button" className="w95-btn" disabled={busy} onClick={() => setAsking(false)}>
          No
        </button>
      </span>
    );
  }
  return (
    <button type="button" className={`w95-btn ${danger ? "host-danger" : ""} ${className ?? ""}`} disabled={disabled} data-testid={testId} onClick={() => setAsking(true)}>
      {label}
    </button>
  );
}

/** A plain write button: busy while its call is out. */
export function ActButton({ label, onClick, disabled, className, title, pressed }: { label: ReactNode; onClick: () => Promise<unknown> | void; disabled?: boolean; className?: string; title?: string; pressed?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`w95-btn ${className ?? ""}`}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      aria-pressed={pressed}
      title={title}
      onClick={() => {
        setBusy(true);
        void Promise.resolve(onClick()).finally(() => setBusy(false));
      }}
    >
      {label}
    </button>
  );
}

/** A section of a tab: a Win95 group-box caption over its rows. */
export function HostSection({ id, title, aside, children }: { id: string; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="host-section" data-section={id} id={`host-${id}`}>
      <h3 className="host-section-head">
        <span>{title}</span>
        {aside !== undefined && <span className="host-section-aside">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

/** What a tab says when it has nothing: what will appear there, and when. */
export function HostEmpty({ children }: { children: ReactNode }) {
  return <p className="host-empty">{children}</p>;
}
