//! The Wanted board (wave 18, BOOTH-SPEC §4.2): every marked program as a
//! full-width poster, behind three tabs (Open · Mine · Everyone). Opened
//! from the NOW card's row, its 🚨 chip, the tray's LED, a burst pop-out,
//! and (read-only) a host's Needs row. It reads only `PrimeView.wanted`, so
//! it survives a reload. Caught programs stay 60 s under the CAPTURED stamp.

import { useState } from "react";
import { BoothLayer } from "../layer.tsx";
import { boardOrder, boardStatus, boardTab, type BoardTab } from "../popouts/model.ts";
import type { WantedEntry } from "../wire.ts";
import { Poster } from "./poster.tsx";

export interface WantedBoardProps {
  wanted: readonly WantedEntry[];
  me: string;
  /** Story ms now. */
  now: number;
  placeTitle: (loc: string | null) => string | null;
  /** Hosts: no claim / scan / take-over buttons. */
  readOnly?: boolean;
  /** The story ships `release_escort` (A2) / `take_over_escort` (A3). */
  canRelease?: boolean;
  canTakeOver?: boolean;
  /** Marked since this phone last opened the board (the NEW tag). */
  fresh?: ReadonlySet<string>;
  /** Story ms this phone first saw each claim. */
  claimedAt?: (id: string) => number | null;
  onClaim?: (id: string) => Promise<unknown> | void;
  onScan?: (id: string, name: string) => void;
  onCard: (id: string) => void;
  onRelease?: (id: string) => Promise<unknown> | void;
  onTakeOver?: (id: string) => Promise<unknown> | void;
  onClose: () => void;
}

const TABS: Array<{ id: BoardTab; label: string }> = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "everyone", label: "Everyone" },
];

/** The tab the board opens on: Open when any is open, else Everyone. */
export function defaultBoardTab(wanted: readonly WantedEntry[], me: string): BoardTab {
  return wanted.some((w) => boardTab(w, "open", me)) ? "open" : "everyone";
}

export function WantedBoard(p: WantedBoardProps) {
  const [tab, setTab] = useState<BoardTab>(() => (p.readOnly ? "everyone" : defaultBoardTab(p.wanted, p.me)));
  const [busy, setBusy] = useState<string | null>(null);
  const loose = p.wanted.filter((w) => !w.captured);
  const rows = boardOrder(p.wanted, p.me).filter((w) => boardTab(w, tab, p.me));
  const run = (id: string, f: ((id: string) => Promise<unknown> | void) | undefined) => () => {
    if (f === undefined || busy !== null) return;
    setBusy(id);
    void Promise.resolve(f(id)).finally(() => setBusy(null));
  };
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <span aria-hidden>🚨</span> Wanted ({loose.length})
        </span>
      }
      label="Wanted board"
      onClose={p.onClose}
      tone="alarm"
      foot={<div className="booth-status">{boardStatus(p.wanted)}{p.readOnly ? " · Radio an Antivirus." : ""}</div>}
    >
      <div className="wanted-board">
        {!p.readOnly && (
          <div className="booth-tabs" role="tablist" aria-label="Which posters">
            {TABS.map((t) => {
              const n = p.wanted.filter((w) => boardTab(w, t.id, p.me)).length;
              return (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`booth-tab ${tab === t.id ? "current" : ""} ${n === 0 ? "zero" : ""}`} onClick={() => setTab(t.id)}>
                  {t.label} ({n})
                </button>
              );
            })}
          </div>
        )}
        {p.wanted.length === 0 ? (
          <p className="booth-none w95-inset">Nobody is marked. The computer is clean… for now.</p>
        ) : rows.length === 0 ? (
          <p className="booth-none">{tab === "mine" ? "You haven't claimed anyone." : "Nobody is waiting for an Antivirus."}</p>
        ) : (
          <div className="wanted-list">
            {rows.map((w) => (
              <Poster
                key={w.id}
                w={w}
                me={p.me}
                now={p.now}
                place={p.placeTitle(w.location)}
                fresh={p.fresh?.has(w.id) === true}
                claimedAt={p.claimedAt?.(w.id) ?? null}
                readOnly={p.readOnly}
                canRelease={p.canRelease}
                canTakeOver={p.canTakeOver}
                busy={busy === w.id}
                onClaim={run(w.id, p.onClaim)}
                onScan={() => p.onScan?.(w.id, w.name)}
                onCard={() => p.onCard(w.id)}
                onRelease={run(w.id, p.onRelease)}
                onTakeOver={run(w.id, p.onTakeOver)}
              />
            ))}
          </div>
        )}
      </div>
    </BoothLayer>
  );
}
