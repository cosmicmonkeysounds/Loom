//! The WANTED poster (wave 18, BOOTH-SPEC §4.2): one marked program on the
//! board — the picture, the name in big type, the reason, 📍 the place, and
//! the buttons this booth may press (claim, scan, hand back, take over);
//! a caught one wears the CAPTURED stamp. `WantedBanner` is the card's
//! inset for a wanted guest.

import { PersonAvatar } from "../../ui/primitives.tsx";
import { GuestBadges } from "../badges.tsx";
import { STALE_CLAIM_MS, boothSeen } from "../popouts/model.ts";
import type { WantedEntry } from "../wire.ts";

export interface PosterProps {
  w: WantedEntry;
  me: string;
  /** Story ms now. */
  now: number;
  /** Wall-clock ms now (`lastSeen` is wall clock); default `Date.now()`. */
  wall?: number;
  place: string | null;
  /** NEW: marked since this phone last opened the board. */
  fresh?: boolean;
  /** Story ms this phone first saw the claim (the take-over clock), when known. */
  claimedAt?: number | null;
  readOnly?: boolean;
  canRelease?: boolean;
  canTakeOver?: boolean;
  busy?: boolean;
  onClaim?: () => void;
  onScan?: () => void;
  onCard?: () => void;
  onRelease?: () => void;
  onTakeOver?: () => void;
}

export function Poster(p: PosterProps) {
  const { w, me } = p;
  const mine = w.claimedBy !== null && w.claimedBy === me;
  const theirs = w.claimedBy !== null && !mine;
  const reason = w.reason?.trim() ?? "";
  const since = p.claimedAt != null ? p.now - p.claimedAt : null;
  const stale = theirs && since !== null && since >= STALE_CLAIM_MS;
  const seen = boothSeen(w.lastSeen, p.wall ?? Date.now());
  const place = `📍 ${p.place ?? "somewhere: not seen in a room"}`;
  return (
    <article className={`wanted-poster ${theirs ? "theirs" : ""} ${w.captured ? "caught" : ""}`} aria-label={`Wanted: ${w.name}`}>
      <div className="wanted-head" aria-hidden>
        W A N T E D
      </div>
      <div className="wanted-main">
        <button type="button" className="wanted-pic" onClick={p.onCard} aria-label={`${w.name}'s card`}>
          <PersonAvatar name={w.name} size="lg" />
          {w.captured && <span className="stamp">CAPTURED</span>}
        </button>
        <div className="wanted-text">
          <button type="button" className="wanted-name" onClick={p.onCard}>
            {w.name}
            <GuestBadges id={w.id} />
          </button>
          {w.captured ? (
            <span className="wanted-tag caught">{w.claimedBy !== null ? `CAUGHT BY ${w.claimedBy.toUpperCase()}` : "CAUGHT"}</span>
          ) : mine ? (
            <span className="wanted-tag you">🙋 YOU</span>
          ) : theirs ? (
            <span className="wanted-tag">🙋 {w.claimedBy}</span>
          ) : p.fresh ? (
            <span className="wanted-tag new">NEW</span>
          ) : null}
          {reason !== "" && <span className="wanted-reason">{reason}</span>}
          <span className="wanted-place">
            {place}
            {/* A caught poster's claim is the capture itself, never "claimed 0 min ago" (BN-F19). */}
            {theirs && !w.captured && since !== null ? ` · claimed ${Math.floor(since / 60_000)} min ago` : !w.captured && seen !== null ? ` · ${seen}` : ""}
          </span>
        </div>
      </div>
      {!w.captured && !p.readOnly && (
        <div className="wanted-actions">
          {w.claimedBy === null && (
            <>
              <button type="button" className="w95-btn booth-default wanted-btn" disabled={p.busy} onClick={p.onClaim}>
                🙋 I'll get them
              </button>
              <button type="button" className="w95-btn wanted-btn" onClick={p.onCard}>
                🗂 Card ›
              </button>
            </>
          )}
          {mine && (
            <>
              <button type="button" className="w95-btn booth-default wanted-btn" onClick={p.onScan}>
                📷 Scan their pass
              </button>
              {p.canRelease && (
                <button type="button" className="w95-btn wanted-btn" disabled={p.busy} onClick={p.onRelease}>
                  Hand back
                </button>
              )}
            </>
          )}
          {stale && (
            <span className="wanted-stale">
              Still on it?{" "}
              {p.canTakeOver && (
                <button type="button" className="w95-btn wanted-btn" disabled={p.busy} onClick={p.onTakeOver}>
                  🙋 Take over
                </button>
              )}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

/** The maroon inset on a wanted guest's card, under the name (§4.2). */
export function WantedBanner({ w, me, busy, onClaim }: { w: WantedEntry; me: string; busy?: boolean; onClaim?: () => void }) {
  const reason = w.reason?.trim() ?? "";
  const who = w.claimedBy === null ? "🙋 Nobody yet" : w.claimedBy === me ? "🙋 You" : `🙋 ${w.claimedBy}`;
  return (
    <div className="wanted-banner" role="note">
      <div className="wanted-banner-head">WANTED{reason !== "" ? ` · ${reason}` : ""}</div>
      <div className="wanted-banner-row">
        <span>{who}</span>
        {w.claimedBy === null && onClaim !== undefined && (
          <button type="button" className="w95-btn wanted-btn" disabled={busy} onClick={onClaim}>
            🙋 I'll get them
          </button>
        )}
      </div>
    </div>
  );
}
