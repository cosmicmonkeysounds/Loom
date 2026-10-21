//! The Notifications window (wave 18, GUEST-SPEC §4.1, Q3): the Recycle Bin
//! of everything that interrupted the guest tonight — every moment and
//! every personal `~` notice, newest first, each with its exits (≤ 2) and a
//! ✕ — and Clear all, with the Win95 delete gags (§4.2). Nothing here sticks
//! or pops. Loaded on first open (`notifications-lazy.tsx`), so its dialogs
//! stay out of the guest's first load.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../chrome/icons.tsx";
import { rowClockOf } from "./show-time.ts";
import { WinDialog } from "../ui/window.tsx";
import { BlockBar } from "../ui/progress.tsx";
import type { Exit, ExitContext, Nav } from "./moments-bridge.ts";
import { clearPlan, exitsOf, gagFor, gagTitle, inUse, notificationsOf, type ClearPlan, type NotificationRow } from "./notification-rows.ts";
import type { ChatMessage } from "../types.ts";

/** How long the fake delete runs. */
export const DELETING_MS = 1200;

export const EMPTY_BIN = "The Recycle Bin is empty. Nothing has interrupted you yet.";
export const EMPTY_PAST = "The Recycle Bin is empty. So is your past.";

type Gag =
  | { kind: "confirm-one"; row: NotificationRow }
  | { kind: "in-use"; row: NotificationRow }
  | { kind: "confirm-all"; plan: ClearPlan }
  | { kind: "deleting"; plan: ClearPlan; k: number }
  | { kind: "denied"; caption: string }
  | { kind: "beans" };

function reduced(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function Deleting({ plan, onDone, onCancel }: { plan: ClearPlan; onDone: () => void; onCancel: (k: number) => void }) {
  const n = Math.max(1, plan.targets.length);
  const [k, setK] = useState(0);
  const still = useRef(reduced());
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const step = still.current ? DELETING_MS : DELETING_MS / n;
    let i = 0;
    const t = setInterval(() => {
      i = still.current ? n : i + 1;
      setK(i);
      if (i >= n) {
        clearInterval(t);
        done.current();
      }
    }, step);
    return () => clearInterval(t);
  }, [n]);
  const now = plan.targets[Math.min(k, plan.targets.length - 1)];
  return (
    <WinDialog title="Deleting…" onClose={() => onCancel(k)} label="Deleting">
      <div className="gag-deleting">
        <div className="gag-strip" aria-hidden>
          📄 ⟶ 🗑
        </div>
        <div className="gag-file">'{gagTitle(now?.title ?? "")}'</div>
        <BlockBar done={k} total={n} label={`${Math.min(k, n)} of ${n}`} />
        <div className="gag-row">
          <button type="button" className="w95-btn" onClick={() => onCancel(k)}>
            Cancel
          </button>
        </div>
      </div>
    </WinDialog>
  );
}

function Row({ row, unread, used, exits, onExit, onDelete, clock }: { row: NotificationRow; unread: boolean; used: boolean; exits: Exit[]; onExit: (e: Exit) => void; onDelete: () => void; clock: (at: number) => string }) {
  return (
    <li className={`notif${unread ? " unread" : ""}`}>
      <div className="notif-head">
        <span className="notif-dot" aria-label={unread ? "new" : undefined}>
          {unread ? "●" : ""}
        </span>
        <span className="notif-glyph" aria-hidden>
          {row.glyph}
        </span>
        <span className="notif-title">{row.folded !== undefined ? `${row.glyph} ${row.title}` : row.title}</span>
        {used && <span className="notif-inuse">IN USE</span>}
        <span className="notif-time">{clock(row.at)}</span>
      </div>
      {(row.caption !== "" || row.rest !== "") && (
        <div className="notif-sub">
          {row.caption}
          {row.caption !== "" && row.rest !== "" ? " · " : ""}
          {row.rest}
        </div>
      )}
      <div className="notif-foot">
        {exits.map((e) => (
          <button key={e.label} type="button" className="w95-btn notif-exit" onClick={() => onExit(e)}>
            {e.icon !== null && <Icon name={e.icon} />} {e.label}
          </button>
        ))}
        <button type="button" className="w95-btn notif-x" aria-label={`Delete ${row.title}`} onClick={onDelete}>
          ✕
        </button>
      </div>
    </li>
  );
}

export interface NotificationsWindowProps {
  messages: ReadonlyMap<number, ChatMessage>;
  me: { id: string; name: string };
  phase: string | null;
  deleted: ReadonlySet<string>;
  mark: number;
  /** The story clock now (ms), for "in use". */
  now: number;
  /** What the guest lists, for each row's exits (as if from Mission). */
  exitContext: () => ExitContext;
  /** A row's exit: close the bin and land there. */
  onGo: (nav: Nav) => void;
  remove: (keys: readonly string[]) => void;
  /** Leaving the window marks every row read. */
  markRead: () => void;
  /** The view (its show clock gives each row's "9:41 PM"). */
  view: { clock?: number } | object;
}

export function NotificationsWindow(props: NotificationsWindowProps) {
  const rows = useMemo(() => notificationsOf(props.messages.values(), props.me, props.phase, props.deleted), [props.messages, props.me, props.phase, props.deleted]);
  const ctx = props.exitContext();
  const p = {
    ...props,
    rows,
    used: (r: NotificationRow) => inUse(r, props.mark, props.now),
    exitsFor: (r: NotificationRow): Exit[] => (r.moment === null ? [] : exitsOf(r.moment, ctx, 2)),
    onExit: (e: Exit) => props.onGo(e.nav),
  };
  const [gag, setGag] = useState<Gag | null>(null);
  const [past, setPast] = useState(false);
  const mark = useRef(p.markRead);
  mark.current = p.markRead;
  useEffect(() => () => mark.current(), []);
  const clock = rowClockOf(props.view as { clock?: number } & Record<string, unknown>);
  const del = (row: NotificationRow) => {
    if (p.used(row)) return setGag({ kind: "in-use", row });
    if (gagFor(row.seq) === "ask") return setGag({ kind: "confirm-one", row });
    p.remove([row.key]);
  };
  const clearAll = () => setGag({ kind: "confirm-all", plan: clearPlan(p.rows, p.used) });
  const finish = (plan: ClearPlan) => {
    p.remove(plan.remove);
    if (plan.outcome === 0) {
      setPast(true);
      setGag(null);
    } else if (plan.outcome === 1) setGag({ kind: "denied", caption: plan.caption ?? "" });
    else setGag({ kind: "beans" });
  };
  return (
    <div className="screen notifications">
      <section className="w95-window notif-window" aria-label="Notifications">
        <div className="w95-titlebar">
          <span className="w95-title">
            <Icon name="bin-full" /> Notifications
          </span>
        </div>
        <div className="notif-bar">
          <button type="button" className="w95-btn notif-clear" onClick={clearAll} disabled={p.rows.length === 0}>
            <Icon name="bin-empty" /> Clear all
          </button>
          <span className="notif-count">{p.rows.length} items</span>
        </div>
        {p.rows.length === 0 ? (
          <div className="notif-empty">
            <Icon name="bin-empty" size={64} />
            <p>{past ? EMPTY_PAST : EMPTY_BIN}</p>
          </div>
        ) : (
          <ul className="notif-list">
            {p.rows.map((r) => (
              <Row key={r.key} row={r} unread={r.seq > p.mark} used={p.used(r)} exits={p.exitsFor(r)} onExit={p.onExit} onDelete={() => del(r)} clock={clock} />
            ))}
          </ul>
        )}
      </section>
      {gag?.kind === "confirm-one" && (
        <WinDialog title="Confirm File Delete" onClose={() => setGag(null)} label="Confirm File Delete">
          <p className="gag-say">🗑 Are you sure you want to send '{gagTitle(gag.row.title)}' to the Recycle Bin?</p>
          <div className="gag-row">
            <button
              type="button"
              className="w95-btn"
              onClick={() => {
                p.remove([gag.row.key]);
                setGag(null);
              }}
            >
              Yes
            </button>
            <button type="button" className="w95-btn" onClick={() => setGag(null)}>
              No
            </button>
          </div>
        </WinDialog>
      )}
      {gag?.kind === "in-use" && (
        <WinDialog title="Error Deleting File" onClose={() => setGag(null)} label="Error Deleting File">
          <p className="gag-say">⛔ Cannot delete '{gagTitle(gag.row.title)}': This item is in use.</p>
          <div className="gag-row">
            <button type="button" className="w95-btn" onClick={() => setGag(null)}>
              OK
            </button>
          </div>
        </WinDialog>
      )}
      {gag?.kind === "confirm-all" && (
        <WinDialog title="Confirm Multiple File Delete" onClose={() => setGag(null)} label="Confirm Multiple File Delete">
          <p className="gag-say">🗑 Are you sure you want to delete these {gag.plan.targets.length} items?</p>
          <div className="gag-row">
            <button type="button" className="w95-btn" onClick={() => setGag(gag.plan.targets.length === 0 ? null : { kind: "deleting", plan: gag.plan, k: 0 })}>
              Yes
            </button>
            <button type="button" className="w95-btn" onClick={() => setGag(null)}>
              No
            </button>
          </div>
        </WinDialog>
      )}
      {gag?.kind === "deleting" && (
        <Deleting
          plan={gag.plan}
          onDone={() => finish(gag.plan)}
          onCancel={(k) => {
            p.remove(gag.plan.targets.slice(0, k).map((r) => r.key));
            setGag(null);
          }}
        />
      )}
      {gag?.kind === "denied" && (
        <WinDialog title="Error Deleting File" onClose={() => setGag(null)} label="Error Deleting File">
          <p className="gag-say">⛔ Cannot delete '{gagTitle(gag.caption)}': Access is denied.</p>
          <div className="gag-row">
            <button type="button" className="w95-btn" onClick={() => setGag(null)}>
              OK
            </button>
          </div>
        </WinDialog>
      )}
      {gag?.kind === "beans" && (
        <WinDialog title="Recycle Bin" onClose={() => setGag(null)} label="Recycle Bin">
          <p className="gag-say">🫘 The Recycle Bin is full of beans.</p>
          <div className="gag-row">
            <button type="button" className="w95-btn" onClick={() => setGag(null)}>
              OK
            </button>
          </div>
        </WinDialog>
      )}
    </div>
  );
}

export default NotificationsWindow;
