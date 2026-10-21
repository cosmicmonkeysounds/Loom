//! The Notifications window (wave 18, the moments lane; GUEST-SPEC §4.1, the
//! user's Q3): the Recycle Bin of everything that interrupted this guest,
//! newest first — each row its glyph, title, caption, story time, an unread
//! dot, up to two exits and a ✕; Clear all; and the delete gags. Nothing in
//! it sticks or pops. The guest lane mounts it as the third window (the 🔔,
//! Start → Notifications, the `notifications` exit); a row's exit navigates
//! through the app's `go`, which leaves this window. Leaving marks every
//! row read.

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../chrome/icons.tsx";
import { WinWindow } from "../ui/window.tsx";
import { DELETE_BAR_MS, GAG_COPY, clearGag, gagFor, mostFrequentCaption } from "./delete-gags.ts";
import type { Exit } from "./exits.ts";
import type { GagStep } from "./gag-dialogs.tsx";
import { deleteKeys, isUnread, rowOfGroup, type NotificationRow } from "./notifications.ts";
import { useMomentsEngineContext } from "./provider.tsx";

/** The Notifications rows and what can be done to them. */
export interface NotificationsApi {
  rows: readonly NotificationRow[];
  unread: number;
  isUnread: (r: NotificationRow) => boolean;
  /** Every row read (the window closed). */
  markRead: () => void;
  /** Delete one row (an unacknowledged big one never goes). */
  remove: (r: NotificationRow) => void;
  /** Delete several (Clear all; an unacknowledged big one stays). */
  removeMany: (rs: readonly NotificationRow[]) => void;
  /** A row's exits (≤ 2). */
  exits: (r: NotificationRow) => Exit[];
  /** Take a row's exit (the guest app's `go` leaves this window). */
  take: (r: NotificationRow, e: Exit) => void;
}

const NO_NOTIFICATIONS: NotificationsApi = { rows: [], unread: 0, isUnread: () => false, markRead: () => {}, remove: () => {}, removeMany: () => {}, exits: () => [], take: () => {} };

/** The Notifications rows (GUEST-SPEC §4): rows, the unread count, mark read, delete, exits. */
export function useNotifications(): NotificationsApi {
  const e = useMomentsEngineContext();
  return useMemo((): NotificationsApi => {
    if (e === null) return NO_NOTIFICATIONS;
    const n = e.notif;
    const sign = n.sign;
    const rows = n.groups.map((g) => rowOfGroup(g, sign.acked));
    return {
      rows,
      unread: n.unread,
      isUnread: (r) => isUnread(r, sign.seen, sign.readMark),
      markRead: () => {
        let max = sign.readMark;
        for (const r of rows) {
          for (const s of r.members) if (s > max) max = s;
          if (r.members.length === 0) sign.seen.add(r.key);
        }
        sign.readMark = max;
        n.save("read");
      },
      remove: (r) => {
        if (r.inUse) return;
        for (const k of deleteKeys(r)) sign.deleted.add(k);
        n.save("deleted");
      },
      removeMany: (rs) => {
        for (const r of rs) if (!r.inUse) for (const k of deleteKeys(r)) sign.deleted.add(k);
        n.save("deleted");
      },
      exits: (r) => e.exits(r.moment, 2, r.big ? { big: true } : {}),
      take: (r, x) => {
        n.markSeen(r.key);
        e.takeExit(r.key, x);
      },
    };
  }, [e]);
}

const GagDialog = lazy(() => import("./gag-dialogs.tsx"));

/** "12 min ago" from story time (the default when the app gives no show clock). */
export function agoText(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min ago`;
}

function prefersStill(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export interface NotificationsWindowProps {
  /** The window's × (the guest lane's way back); absent → no ×. */
  onClose?: () => void;
  /** A row's time (the guest lane's show clock: "9:41 PM"); default "n min ago". */
  timeOf?: (storyMs: number) => string;
}

export function NotificationsWindow({ onClose, timeOf }: NotificationsWindowProps) {
  const api = useNotifications();
  const engine = useMomentsEngineContext();
  const [gag, setGag] = useState<GagStep | null>(null);
  const [pastEmpty, setPastEmpty] = useState(false);
  const pending = useRef<{ yes: () => void } | null>(null);
  const timer = useRef<number | null>(null);
  // Leaving the window marks every row read.
  const latest = useRef(api);
  latest.current = api;
  useEffect(() => () => latest.current.markRead(), []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    [],
  );
  const rows = api.rows;
  const now = (() => {
    let max = 0;
    for (const m of engine?.input.messages.values() ?? []) if (Number.isInteger(m.seq) && m.ts > max) max = m.ts;
    return Math.max(max, engine?.input.clock ?? 0);
  })();
  const time = timeOf ?? ((at: number) => agoText(at, now));

  const close = () => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
    pending.current = null;
    setGag(null);
  };
  const deleteOne = (r: NotificationRow) => {
    if (r.inUse) {
      setGag({ kind: "inUse", title: r.title });
      return;
    }
    if (gagFor(r.seq) === "confirm") {
      pending.current = { yes: () => api.remove(r) };
      setGag({ kind: "confirm", title: r.title });
      return;
    }
    api.remove(r);
  };
  const clearAll = () => {
    const doomed = rows.filter((r) => !r.inUse);
    if (doomed.length === 0) return;
    const n = doomed.length;
    pending.current = {
      yes: () => {
        const outcome = clearGag(n, rows[0]?.seq ?? 0);
        const keep = outcome === 1 ? mostFrequentCaption(doomed.map((r) => r.caption)) : null;
        const go = doomed.filter((r) => keep === null || r.caption !== keep);
        const still = prefersStill();
        let k = 0;
        const step = Math.max(40, Math.floor(DELETE_BAR_MS / n));
        setGag({ kind: "deleting", title: doomed[0]!.title, k, n, still });
        timer.current = window.setInterval(() => {
          k += 1;
          const row = doomed[k - 1];
          if (row !== undefined && go.includes(row)) latest.current.remove(row);
          if (k >= n) {
            if (timer.current !== null) window.clearInterval(timer.current);
            timer.current = null;
            if (outcome === 0) {
              setPastEmpty(true);
              setGag(null);
            } else if (outcome === 1) setGag({ kind: "denied", caption: keep ?? "" });
            else {
              latest.current.removeMany(doomed);
              setGag({ kind: "beans" });
            }
            return;
          }
          setGag({ kind: "deleting", title: doomed[k]?.title ?? "", k, n, still });
        }, step);
      },
    };
    setGag({ kind: "confirmAll", n });
  };
  const yes = () => {
    const p = pending.current;
    pending.current = null;
    setGag(null);
    p?.yes();
  };

  return (
    <WinWindow
      className="moments-notif"
      title={
        <>
          <Icon name="bell" size={16} /> Notifications
        </>
      }
      {...(onClose !== undefined ? { onClose } : {})}
    >
      <div className="moments-notif-bar">
        <button type="button" className="w95-btn moments-notif-clear" onClick={clearAll} disabled={rows.every((r) => r.inUse)}>
          🗑 Clear all
        </button>
        <span className="moments-notif-count">{rows.length === 1 ? "1 item" : `${rows.length} items`}</span>
      </div>
      {rows.length === 0 ? (
        <div className="moments-notif-empty">
          <span className="moments-notif-bin" aria-hidden>
            🗑
          </span>
          <p>{pastEmpty ? GAG_COPY.emptyPast : GAG_COPY.empty}</p>
        </div>
      ) : (
        <ol className="moments-notif-list w95-inset">
          {rows.map((r) => {
            const unread = api.isUnread(r);
            const exits = api.exits(r);
            return (
              <li key={r.key} className={`moments-notif-row${unread ? " unread" : ""}${r.inUse ? " in-use" : ""}`}>
                <div className="moments-notif-head">
                  <span className="moments-notif-dot" aria-label={unread ? "New" : undefined}>
                    {unread ? "●" : ""}
                  </span>
                  <span className="moments-notif-glyph" aria-hidden>
                    {r.glyph}
                  </span>
                  <span className="moments-notif-title">{r.title}</span>
                  <span className="moments-notif-time">{time(r.at)}</span>
                </div>
                {(r.caption !== "" || r.rest !== "") && (
                  <p className="moments-notif-sub">
                    {r.caption}
                    {r.rest !== "" ? ` · ${r.rest}` : ""}
                  </p>
                )}
                <div className="moments-notif-foot">
                  {r.inUse && <span className="moments-notif-inuse">● IN USE</span>}
                  {exits.map((x) => (
                    <button key={`${x.nav.to}:${x.label}`} type="button" className="w95-btn moments-notif-go" onClick={() => api.take(r, x)}>
                      {x.icon !== null && <Icon name={x.icon} size={16} />}
                      <span className="moments-exit-label">{x.label}</span>
                    </button>
                  ))}
                  <button type="button" className="w95-btn moments-notif-x" aria-label={`Delete: ${r.title}`} onClick={() => deleteOne(r)}>
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {gag !== null && (
        <Suspense fallback={null}>
          <GagDialog step={gag} onYes={yes} onClose={close} />
        </Suspense>
      )}
    </WinWindow>
  );
}
