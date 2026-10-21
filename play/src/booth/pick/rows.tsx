//! The Rows window (wave 18, BOOTH-SPEC §4.10): an objective whose pick is a
//! list to work through — Truth Pong's throwers, the summons' *Still
//! missing*, the cup-makers — one row per program with the objective's
//! buttons right on it (a destructive one arms: two taps). A pressed row
//! greys with ✓ and leaves on the next snapshot. The summons' rows say
//! *📍 They're here* (only for a dead or lost phone: guests check themselves
//! in with the Desktop QR) and the window says *Summons over.* when it ends.

import { useState } from "react";
import { useArmButtons } from "../../arm.ts";
import { PersonAvatar } from "../../ui/primitives.tsx";
import type { Interaction, PrimeActResult, PrimeGuest } from "../../types.ts";
import { BoothLayer } from "../layer.tsx";
import { armsFirst, filterGuests } from "../model.ts";
import { objectiveButtons, replyLine } from "../popouts/model.ts";
import type { BoothObjective } from "../wire.ts";

/** The summons' own button id (A5) and how a row says it. */
export const CHECK_IN_ID = "check_in_at_desktop";
export const THEYRE_HERE = "📍 They're here";

/** A row button's label: the summons' check-in reads "📍 They're here"; a destructive one "· ×2" until armed. */
export function rowLabel(i: Pick<Interaction, "id" | "label" | "arm">, armed: boolean): string {
  if (armed) return "Tap again";
  const base = i.id === CHECK_IN_ID ? THEYRE_HERE : i.label;
  return armsFirst(i) ? `${base} · ×2` : base;
}

/** Is this the summons' list (its rows check people in)? */
export function isSummons(o: Pick<BoothObjective, "buttons" | "id" | "title">): boolean {
  return o.buttons.includes(CHECK_IN_ID) || /summons/iu.test(`${o.id} ${o.title}`);
}

export interface RowsProps {
  /** The objective now; undefined once it stopped being live (the window says so). */
  objective: BoothObjective | undefined;
  /** The objective as it was when the window opened (its title, after it ends). */
  opened: BoothObjective;
  interactions: readonly Interaction[];
  guests: readonly PrimeGuest[];
  placeTitle: (loc: string | null) => string | null;
  /** The soonest countdown, already formatted ("⏳ 3:41"), for the caption. */
  countdown?: string | null;
  /** Loose marks (after the summons: open the board). */
  wanted?: number | null;
  press: (id: string, guest: string) => Promise<PrimeActResult>;
  onCard: (id: string) => void;
  onBoard?: () => void;
  onClose: () => void;
}

export function RowsWindow(p: RowsProps) {
  const arm = useArmButtons();
  const [q, setQ] = useState("");
  const [pressed, setPressed] = useState<Array<{ id: string; name: string; label: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [fold, setFold] = useState(false);
  const o = p.objective ?? p.opened;
  const over = p.objective === undefined;
  const summons = isSummons(o);
  const byId = new Map(p.guests.map((g) => [g.id, g]));
  const ids = p.objective?.pick ?? [];
  const list = ids.map((id) => byId.get(id)).filter((g): g is PrimeGuest => g !== undefined);
  const shown = q.trim() !== "" ? filterGuests(list, q) : list;
  const btns = objectiveButtons(o, p.interactions);
  const inline = btns.slice(0, 2);
  const more = btns.length > 2;
  const done = new Set(pressed.map((x) => x.id));
  const go = (b: Interaction, g: PrimeGuest) => {
    if (busy !== null) return;
    arm.tap(`${b.id}:${g.id}`, armsFirst(b), () => {
      setBusy(g.id);
      p.press(b.id, g.id).then(
        (r) => {
          setBusy(null);
          setReply(replyLine(g.name, r));
          if (r.refused !== true) setPressed((l) => [...l, { id: g.id, name: g.name, label: b.id === CHECK_IN_ID ? THEYRE_HERE : b.label }]);
        },
        (e: unknown) => {
          setBusy(null);
          setReply(`Not done: ${e instanceof Error ? e.message : String(e)}`);
        },
      );
    });
  };
  const left = list.filter((g) => !done.has(g.id)).length;
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <span aria-hidden>📋</span> {o.title} · {left} left{p.countdown ? <span className="rows-clock"> {p.countdown}</span> : null}
        </span>
      }
      label={o.title}
      onClose={p.onClose}
      foot={reply !== "" ? <div className={`booth-status ${reply.startsWith("Not done") ? "refused" : ""}`}>{reply}</div> : undefined}
    >
      <div className="rows">
        {summons && !over && <p className="rows-note">They check themselves in with the Desktop QR. Tap 📍 only for a phone that's dead or lost.</p>}
        {over ? (
          <div className="rows-over w95-inset">
            <p>{summons ? "Summons over." : "Done here."}</p>
            {p.onBoard !== undefined && (p.wanted ?? 0) > 0 ? (
              <button type="button" className="w95-btn booth-default rows-btn" onClick={p.onBoard}>
                🚨 Open the Wanted board
              </button>
            ) : (
              <button type="button" className="w95-btn booth-default rows-btn" onClick={p.onClose}>
                OK
              </button>
            )}
          </div>
        ) : (
          <>
            {list.length > 8 && <input className="w95-inset booth-search" type="search" placeholder="Find a program…" aria-label="Find a program" value={q} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setQ(e.target.value)} />}
            {shown.length === 0 && <p className="booth-none">{list.length === 0 ? "Nobody left on this list." : "Nobody matches."}</p>}
            <ul className="rows-list">
              {shown.map((g) => {
                const gone = done.has(g.id);
                return (
                  <li key={g.id} className={`rows-row ${gone ? "pressed" : ""}`}>
                    <button type="button" className="rows-who" onClick={() => p.onCard(g.id)}>
                      <PersonAvatar name={g.name} size="sm" />
                      <span className="rows-name">
                        {gone ? "✓ " : ""}
                        {g.name}
                      </span>
                      <span className="rows-place">📍 {p.placeTitle(g.location) ?? "not in a room"}</span>
                    </button>
                    <div className="rows-btns">
                      {inline.map((b) => {
                        const armed = arm.armed === `${b.id}:${g.id}`;
                        return (
                          <button key={b.id} type="button" className={`w95-btn rows-btn ${armsFirst(b) ? "harm" : ""} ${armed ? "armed" : ""}`} disabled={gone || busy !== null} aria-busy={busy === g.id || undefined} onClick={() => go(b, g)}>
                            {rowLabel(b, armed)}
                          </button>
                        );
                      })}
                      {more && (
                        <button type="button" className="w95-btn rows-btn rows-more" aria-label={`More for ${g.name}`} onClick={() => p.onCard(g.id)}>
                          ⋯
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {pressed.length > 0 && (
          <div className="booth-earlier">
            <button type="button" className="booth-fold" aria-expanded={fold} onClick={() => setFold((v) => !v)}>
              {fold ? "▾" : "▸"} Done here ({pressed.length})
            </button>
            {fold && (
              <ul className="booth-earlier-list">
                {pressed.map((x, n) => (
                  <li key={n}>
                    ✓ {x.name}: {x.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </BoothLayer>
  );
}

