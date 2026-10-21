//! Sides & crews, the sheets (wave 18, GUEST-SPEC §9.2–9.5): the Sides
//! sheet (each side, its leader, its head count, Join / Switch / Leave, and
//! your crew), the Recruit sheet a scanned pass opens, the answer sheet for
//! an invitation, and Found a crew. One lazy chunk (`sides/lazy.tsx`),
//! with the doors and the invite card (`doors.tsx`, `invite.tsx`).

import { useEffect, useState } from "react";
import type { GuestView } from "../types.ts";
import type { SidesCalls } from "../session/guest.ts";
import { PersonAvatar, Sheet } from "../ui/primitives.tsx";
import { BlockBar } from "../ui/progress.tsx";
import type { InviteView } from "../guest/wire.ts";
import { countLine, crewNameOk, crewOf, crewRefusal, crewRoom, recruitOffer, recruitRefusal, sideAction, sidesOf, switchQuestion, type SideRow } from "./model.ts";

export type SidesWhich =
  | { sheet: "sides" }
  | { sheet: "recruit"; id: string }
  | { sheet: "answer"; invite: InviteView }
  | { sheet: "found" };

export interface SidesLayerProps {
  which: SidesWhich;
  view: GuestView;
  calls: SidesCalls;
  /** Open a room (the crew room) and close the sheet. */
  openRoom: (id: string) => void;
  /** 📷 Recruit someone: the Scan sheet. */
  scan: () => void;
  /** 👤 See their profile. */
  profile: (id: string) => void;
  /** Swap to another sheet (Found a crew from Sides). */
  show: (w: SidesWhich) => void;
  onClose: () => void;
}

function errText(e: unknown): string {
  const m = String((e as { message?: unknown }).message ?? "").trim();
  return m !== "" ? m : "That didn't go through — try again.";
}

function SideCard({ side, view, rows, calls, scan }: { side: SideRow; view: GuestView; rows: readonly SideRow[]; calls: SidesCalls; scan: () => void }) {
  const [asking, setAsking] = useState<"leave" | "switch" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = sideAction(side, view, rows);
  const run = (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    void f().then(
      () => {
        setBusy(false);
        setAsking(null);
      },
      (e: unknown) => {
        setBusy(false);
        setErr(errText(e));
      },
    );
  };
  const line = [side.leader !== null ? `led by ${side.leader}` : null, countLine(side) || null].filter((x): x is string => x !== null).join(" · ");
  const mine = act === "in" || (act === "leader" && (side.mine || view.faction === side.name)) || (act === "restricted" && (side.mine || view.faction === side.name));
  return (
    <section className={`side-card${mine ? " mine" : ""}`} aria-label={side.name}>
      <div className="side-card-head">
        <span className="side-card-name">◆ {side.name}</span>
        {mine && <span className="side-in">YOU'RE IN</span>}
      </div>
      {(line !== "" || side.needs !== null) && (
        <div className="side-card-line">
          {line}
          {side.needs !== null && side.members !== null && <BlockBar done={side.members} total={side.needs} cells={10} />}
        </div>
      )}
      {act === "leader" && <p className="side-note">Leaders stay with their side.</p>}
      {act === "restricted" && <p className="side-note">Not while you're restricted.</p>}
      {asking === "leave" && (
        <div className="side-ask" role="group" aria-label="Back to neither?">
          <span>Back to neither?</span>
          <button type="button" className="w95-btn danger" disabled={busy} onClick={() => run(() => calls.leave())}>
            Leave
          </button>
          <button type="button" className="w95-btn" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </div>
      )}
      {asking === "switch" && (
        <div className="side-ask" role="group" aria-label={switchQuestion(side.name)}>
          <span>{switchQuestion(side.name)}</span>
          <button type="button" className="w95-btn" disabled={busy} onClick={() => run(() => calls.defect(side.name))}>
            Switch
          </button>
          <button type="button" className="w95-btn" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </div>
      )}
      {asking === null && (
        <div className="side-buttons">
          {act === "in" && (
            <>
              <button type="button" className="w95-btn side-btn" onClick={scan}>
                📷 Recruit someone
              </button>
              <button type="button" className="w95-btn side-btn" onClick={() => setAsking("leave")}>
                Leave
              </button>
            </>
          )}
          {act === "join" && (
            <button type="button" className="w95-btn side-btn" disabled={busy} onClick={() => run(() => calls.join(side.name))}>
              Join {side.name}
            </button>
          )}
          {act === "switch" && (
            <button type="button" className="w95-btn side-btn" onClick={() => setAsking("switch")}>
              Switch to {side.name}
            </button>
          )}
        </div>
      )}
      {err !== null && <p className="err side-err">{err}</p>}
    </section>
  );
}

export function SidesSheet({ view, calls, openRoom, scan, show, onClose }: Omit<SidesLayerProps, "which" | "profile">) {
  const rows = sidesOf(view);
  const crew = crewOf(view);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet title="Sides & crews" onClose={onClose} tall>
      <div className="sides-sheet">
        <div className="sheet-h">SIDES</div>
        {rows.length === 0 ? (
          <p className="side-note">No sides yet. The house will tell you when they open.</p>
        ) : (
          rows.map((r) => <SideCard key={r.id} side={r} view={view} rows={rows} calls={calls} scan={scan} />)
        )}
        <div className="sheet-h">YOUR CREW</div>
        {crew !== null ? (
          <section className="side-card crew">
            <div className="side-card-head">
              <span className="side-card-name">◇ {crew.name}</span>
              <span className="side-card-line">{crew.members.length} members</span>
            </div>
            {asking ? (
              <div className="side-ask" role="group" aria-label={`Leave ${crew.name}?`}>
                <span>Leave {crew.name}?</span>
                <button
                  type="button"
                  className="w95-btn danger"
                  onClick={() =>
                    void calls.leaveCrew().then(
                      () => setAsking(false),
                      (e: unknown) => setErr(errText(e)),
                    )
                  }
                >
                  Leave
                </button>
                <button type="button" className="w95-btn" onClick={() => setAsking(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="side-buttons">
                <button type="button" className="w95-btn side-btn" onClick={() => openRoom(crewRoom(crew))}>
                  💬 Open the crew room
                </button>
                <button type="button" className="w95-btn side-btn" onClick={() => setAsking(true)}>
                  Leave the crew
                </button>
              </div>
            )}
            {err !== null && <p className="err side-err">{err}</p>}
          </section>
        ) : (
          <button type="button" className="choice side-found" onClick={() => show({ sheet: "found" })}>
            ＋ Found a crew
          </button>
        )}
        <p className="side-dim">Crews are just friends. They never count toward a side.</p>
      </div>
    </Sheet>
  );
}

export function RecruitSheet({ id, view, calls, profile, onClose }: { id: string; view: GuestView; calls: SidesCalls; profile: (id: string) => void; onClose: () => void }) {
  const offer = recruitOffer(view, id);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [sent, onClose]);
  const send = (f: () => Promise<unknown>, side: string | null) =>
    void f().then(
      () => setSent(true),
      (e: unknown) => setErr(recruitRefusal(e, offer.name, side)),
    );
  return (
    <Sheet title="Recruit" onClose={onClose}>
      <div className="recruit">
        <div className="recruit-who">
          <PersonAvatar name={offer.name} size="lg" />
          <div>
            <strong>{offer.name}</strong>
            <div className="side-dim">{offer.sub}</div>
          </div>
        </div>
        {offer.note !== null && <p className="side-note">{offer.note}</p>}
        {!sent && offer.side !== null && (
          <button type="button" className="choice primary recruit-go" onClick={() => send(() => calls.recruit(id), offer.side!.side)}>
            {offer.side.label}
          </button>
        )}
        {!sent && offer.crew !== null && (
          <button type="button" className="choice recruit-go" onClick={() => send(() => calls.invite(id), null)}>
            {offer.crew.label}
          </button>
        )}
        <button type="button" className="choice ghost" onClick={() => profile(id)}>
          👤 See their profile
        </button>
        {sent && <p className="recruit-sent">✓ Invitation sent to {offer.name}.</p>}
        {err !== null && <p className="err">{err}</p>}
      </div>
    </Sheet>
  );
}

export function RecruitAnswerSheet({ invite, view, calls, onClose }: { invite: InviteView; view: GuestView; calls: SidesCalls; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const side = invite.kind === "side" ? sidesOf(view).find((s) => s.id === invite.target || s.name === invite.targetName) : undefined;
  const answer = (yes: boolean) =>
    void calls.answer(invite.id, yes).then(
      () => onClose(),
      (e: unknown) => setErr(errText(e)),
    );
  return (
    <Sheet title="🚪 An invitation" onClose={onClose}>
      <div className="invite-sheet">
        <p className="invite-head">
          {invite.fromName} wants you in {invite.targetName}
        </p>
        {side !== undefined && countLine(side) !== "" && <p className="side-dim">{countLine(side)}</p>}
        <div className="invite-buttons">
          <button type="button" className="choice" onClick={() => answer(false)}>
            Not now
          </button>
          <button type="button" className="choice primary" onClick={() => answer(true)}>
            Join {invite.targetName}
          </button>
        </div>
        {err !== null && <p className="err">{err}</p>}
      </div>
    </Sheet>
  );
}

export function FoundCrewSheet({ calls, onClose }: { calls: SidesCalls; onClose: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (!crewNameOk(name) || busy) return;
    setBusy(true);
    setErr(null);
    void calls.found(name.trim()).then(
      () => onClose(),
      (e: unknown) => {
        setBusy(false);
        setErr(crewRefusal(e));
      },
    );
  };
  return (
    <Sheet title="Found a crew" onClose={onClose}>
      <form
        className="found-crew"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="crew-name">Name your crew</label>
        <input id="crew-name" className="found-crew-input" value={name} maxLength={24} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        <p className="side-dim">A crew is your own club with its own room. It isn't a side and never counts toward one. Invite people by scanning their pass.</p>
        <button type="submit" className="choice primary" disabled={!crewNameOk(name) || busy}>
          Found it ◇
        </button>
        {err !== null && <p className="err">{err}</p>}
      </form>
    </Sheet>
  );
}

/** Whichever sheet is asked for (the lazy chunk's one export). */
export function SidesLayer(p: SidesLayerProps) {
  switch (p.which.sheet) {
    case "sides":
      return <SidesSheet view={p.view} calls={p.calls} openRoom={p.openRoom} scan={p.scan} show={p.show} onClose={p.onClose} />;
    case "recruit":
      return <RecruitSheet id={p.which.id} view={p.view} calls={p.calls} profile={p.profile} onClose={p.onClose} />;
    case "answer":
      return <RecruitAnswerSheet invite={p.which.invite} view={p.view} calls={p.calls} onClose={p.onClose} />;
    case "found":
      return <FoundCrewSheet calls={p.calls} onClose={p.onClose} />;
  }
}

export default SidesLayer;
