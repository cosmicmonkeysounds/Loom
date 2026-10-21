//! The doors (wave 18, GUEST-SPEC §9.1, F2): the side reveal as two Win95
//! windows on a black screen, each a side with its leader and its head
//! count, and *Neither* under them. Walk in joins (the switching join, no
//! confirm: it is reversible), says *You are in {Side}.* for 1.2 s, then
//! answers the card (the big moment closes on the answer). Neither answers
//! with no call (neither is the default). A card in its room renders the
//! same doors; answered, it says what was chosen.
//!
//! Wave 18b, faction mode (`founding:`): a door for every faction (the
//! declared sides and the founded ones), each with who leads or founded it
//! and its ethos but **no count** (nobody counts a rival); Walk in joins the
//! faction (a founded one by its walk-in join) — from another faction it
//! asks *Switch to X? You'll leave Y.* on the door first; a leader, a
//! founder or a restricted program can't walk anywhere (the foot says why);
//! *＋ Start your own faction* sits above *Neither* while the story lets
//! you found one.

import { useEffect, useRef, useState } from "react";
import type { WidgetProps } from "../widgets.tsx";
import { BlockBar } from "../ui/progress.tsx";
import { canFoundOf } from "../guest/wire.ts";
import { useSides } from "./context.ts";
import { countLine, crewNameOk, crewRefusal, factionAction, factionModeOf, joinFaction, myRow, sidesOf, switchQuestion, whoLine, type SideRow } from "./model.ts";
import { stayNote } from "./stay.ts";
import "../css/factions.css";

/** How long the chosen door says so before the card answers. */
export const DOOR_SAY_MS = 1200;

/** An answer sent after a pause — or at once when flushed (an unmount).
 *  Sent exactly once either way. */
export class DeferredAnswer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private send: (() => void) | null = null;
  schedule(send: () => void, ms: number): void {
    this.flush();
    this.send = send;
    this.timer = setTimeout(() => this.flush(), ms);
  }
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const send = this.send;
    this.send = null;
    send?.();
  }
}

/** The card's words as the kicker (line 1) and the headline (line 2). A
 *  one-line text splits after its first sentence, so the kicker never
 *  repeats the headline (GN-F8). */
export function doorWords(text: string): { kicker: string; say: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) return { kicker: lines[0]!, say: lines[1]! };
  const one = lines[0] ?? "";
  const m = /^(.+?[.!?])\s+(\S.*)$/u.exec(one);
  if (m !== null) return { kicker: m[1]!, say: m[2]! };
  return { kicker: one, say: "Two doors have opened in the computer." };
}

/** The side an answered card names. A card the server says is answered
 *  carries no result (a new phone, a reload): the side the guest is on now
 *  (N1: the doors said "You chose neither." to a guest in Unlimited Power). */
export function answeredSide(picked: string | null, rows: readonly SideRow[]): string | null {
  if (picked === "neither") return null;
  if (picked === null) return rows.find((r) => r.mine)?.name ?? null;
  return rows.find((r) => r.id === picked)?.name ?? picked;
}

/** What tapping a door's button does (faction mode): your own door
 *  stays; from another faction it asks before switching; else it walks in. */
export function doorTap(row: Pick<SideRow, "id">, mine: Pick<SideRow, "id"> | null): "stay" | "ask" | "walk" {
  if (mine === null) return "walk";
  return row.id === mine.id ? "stay" : "ask";
}

export function Doors({ card, onAnswer, answered, superseded }: WidgetProps) {
  const { view, calls } = useSides();
  const rows = sidesOf(view);
  const factions = factionModeOf(view);
  const [chosen, setChosen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [founding, setFounding] = useState(false);
  const [name, setName] = useState("");
  // Faction mode: the door a member of another faction is asked about
  // (*Switch to X? You'll leave Y.*, as the Factions cards ask).
  const [asking, setAsking] = useState<string | null>(null);
  // The answer waiting out DOOR_SAY_MS. An unmount (the big closing under
  // it, a room switch) sends it at once: the join already happened, so the
  // card must settle (wave 18 fix: Walk in left the card open all night).
  const later = useRef<DeferredAnswer | null>(null);
  if (later.current === null) later.current = new DeferredAnswer();
  useEffect(() => () => later.current?.flush(), []);
  const { kicker, say } = doorWords(card.text);
  // The night ended with the card up: a closing card replaced it (N5).
  const shut = answered == null && (superseded === true || card.params["closed"] === "true");
  const live = onAnswer !== undefined && calls !== null && answered == null && !shut;
  const pickedName = (answered?.["side"] as string | undefined) ?? null;
  const walk = (id: string, name: string) => {
    if (!live || busy) return;
    setBusy(true);
    setErr(null);
    const row = rows.find((r) => r.id === id);
    const go = factions && row !== undefined && view !== null ? joinFaction(row, view, rows, calls!) : calls!.join(name);
    void go.then(
      () => {
        setChosen(name);
        later.current!.schedule(() => onAnswer!({ side: id }), DOOR_SAY_MS);
      },
      (e: unknown) => {
        setBusy(false);
        setErr(String((e as { message?: unknown }).message ?? "That door didn't open — try again."));
      },
    );
  };
  // ＋ Start your own faction (faction mode): found it here, then answer
  // the card with the new faction, as a walk-in would.
  const found = () => {
    if (!live || busy || !crewNameOk(name)) return;
    setBusy(true);
    setErr(null);
    const n = name.trim();
    void calls!.found(n).then(
      (r) => {
        setChosen(r.crew?.name ?? n);
        setFounding(false);
        later.current!.schedule(() => onAnswer!({ side: r.crew?.id ?? n }), DOOR_SAY_MS);
      },
      (e: unknown) => {
        setBusy(false);
        setErr(crewRefusal(e));
      },
    );
  };
  if (shut) {
    return (
      <div className="widget doors-done">
        <div className="widget-title">🚪 The doors have closed.</div>
      </div>
    );
  }
  if (!live && answered != null) {
    const side = answeredSide(pickedName, rows);
    return (
      <div className="widget doors-done">
        <div className="widget-title">🚪 {kicker || "The doors"}</div>
        <div className="widget-sub">{side === null ? "You chose neither." : `You are in ${side}.`}</div>
      </div>
    );
  }
  // Faction mode: a leader or a founder stays with theirs, and a
  // restricted program moves nowhere (said once).
  const mine = factions ? myRow(view, rows) : null;
  const stays = factions && view !== null ? rows.map((r) => (r.id === mine?.id ? null : factionAction(r, view, rows))).find((a) => a === "leader" || a === "founder" || a === "restricted") ?? null : null;
  const canFound = factions && canFoundOf(view) && chosen === null;
  return (
    <div className="doors" role="group" aria-label={factions ? "Choose a faction" : "Choose a side"}>
      {kicker !== "" && <div className="doors-kicker">{kicker}</div>}
      <div className="doors-say">{say}</div>
      <div className={`doors-row${rows.length > 2 ? " many" : ""}`}>
        {rows.map((r) => (
          <section key={r.id} className={`w95-window door${chosen === r.name ? " open" : ""}`} aria-label={r.name}>
            <div className="w95-titlebar">
              <span className="w95-title">▣ {r.name.toUpperCase()}</span>
            </div>
            <div className="door-body">
              {chosen === r.name ? (
                <p className="door-in">You are in {r.name}.</p>
              ) : factions && asking === r.id && mine !== null ? (
                <>
                  <p className="door-ask">{switchQuestion(r.name, mine.name)}</p>
                  <button type="button" className="choice primary door-go" disabled={!live || busy} onClick={() => walk(r.id, r.name)}>
                    Switch ▸
                  </button>
                  <button type="button" className="choice door-cancel" disabled={busy} onClick={() => setAsking(null)}>
                    Cancel
                  </button>
                </>
              ) : factions ? (
                <>
                  {whoLine(r) !== null && <p className="door-leader">{whoLine(r)}</p>}
                  {r.ethos !== null && <p className="door-ethos">{r.ethos}</p>}
                  {r.id === mine?.id ? (
                    <button type="button" className="choice primary door-go" disabled={!live || busy} onClick={() => onAnswer?.({ side: r.id })}>
                      Stay ▸
                    </button>
                  ) : (
                    <button type="button" className="choice primary door-go" disabled={!live || busy || stays !== null} onClick={() => (doorTap(r, mine) === "ask" ? setAsking(r.id) : walk(r.id, r.name))}>
                      Walk in ▸
                    </button>
                  )}
                </>
              ) : (
                <>
                  {r.leader !== null && <p className="door-leader">led by {r.leader}</p>}
                  {r.needs !== null && r.members !== null && <BlockBar done={r.members} total={r.needs} cells={10} />}
                  {countLine(r) !== "" && <p className="door-count">{countLine(r)}</p>}
                  <button type="button" className="choice primary door-go" disabled={!live || busy} onClick={() => walk(r.id, r.name)}>
                    Walk in ▸
                  </button>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
      {stays !== null && chosen === null && <p className="doors-foot">{stayNote(stays)}</p>}
      {canFound && !founding && (
        <button type="button" className="choice doors-found" disabled={!live || busy} onClick={() => setFounding(true)}>
          ＋ Start your own faction
        </button>
      )}
      {canFound && founding && (
        <form
          className="doors-found-form"
          onSubmit={(e) => {
            e.preventDefault();
            found();
          }}
        >
          <label htmlFor="doors-faction-name">Name your faction</label>
          <input id="doors-faction-name" className="found-crew-input" value={name} maxLength={24} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <div className="invite-buttons">
            <button type="button" className="choice" onClick={() => setFounding(false)}>
              Cancel
            </button>
            <button type="submit" className="choice primary" disabled={!live || busy || !crewNameOk(name)}>
              Found it ◆
            </button>
          </div>
        </form>
      )}
      <button type="button" className="choice doors-neither" disabled={!live || busy} onClick={() => onAnswer?.({ side: "neither" })}>
        Neither. I'll pursue my own interests.
      </button>
      {err !== null && <p className="err doors-err">{err}</p>}
      <p className="doors-foot">{factions ? "You can switch from ⊞ Start → Factions." : "You can switch sides from ⊞ Start → Sides."}</p>
    </div>
  );
}
