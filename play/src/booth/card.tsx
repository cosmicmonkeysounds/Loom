//! A guest's card in the booth, and how a booth's buttons split (moved out
//! of `performer.tsx` in wave 13).

import { useState } from "react";
import { ActionRow, GroupPill, PersonAvatar, PickerSheet, Sheet } from "../ui/primitives.tsx";
import { interactionAction, useArmButtons } from "../arm.ts";
import { foldName } from "../avatars.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { Action, Interaction, PrimeGuest } from "../types.ts";

/**
 * Split the story's performer buttons for one booth: `mine` — this
 * character's own (or anyone's) and on offer right now (`while:`), in
 * story order; `more` — the rest (another character's, out of phase, and
 * for an admin the director's cues), folded under "More…" so the button a
 * performer needs is never at the bottom of a long scroll. Another
 * character's `by:` button (`only`) is left out: the server refuses it from
 * this booth. An admin's booth keeps it under More (a moderator may press any).
 */
export function splitInteractions(list: readonly Interaction[], character: string, admin: boolean): { mine: Interaction[]; more: Interaction[] } {
  const mine: Interaction[] = [];
  const more: Interaction[] = [];
  const me = foldName(character);
  for (const i of list) {
    if (i.who === "admin") {
      if (admin) more.push(i);
      continue;
    }
    const ours = i.actors === undefined || i.actors.some((a) => foldName(a) === me);
    if (!ours && i.only === true && !admin) continue;
    (ours && i.live !== false ? mine : more).push(i);
  }
  return { mine, more };
}

/**
 * A guest's card — everything a performer can do *to* this guest: scan,
 * share lore, the story's declared performer/admin interactions, and
 * capture/release for stories still on the v3 prison mechanic. Opened from
 * a guest thread's header, a room's who's-here list, or a sender's name.
 */
export function GuestCard({
  session,
  guest,
  admin,
  onClose,
  onOpenThread,
}: {
  session: PrimeSession;
  guest: PrimeGuest;
  admin: boolean;
  onClose: () => void;
  onOpenThread: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const lore = session.view?.codex ?? [];
  const where = guest.location ? (session.view?.channels.find((c) => c.id === `loc:${guest.location}`)?.title ?? guest.location) : null;
  const [more, setMore] = useState(false);
  const arm = useArmButtons();
  const actions: Action[] = [{ label: "📡 Scan this guest", onClick: () => void session.scan(guest.id), tone: "primary" }];
  if (lore.length > 0) actions.push({ label: "📓 Share lore…", onClick: () => setSharing(true) });
  // The story's buttons: this character's own, on offer now, first; every
  // other one (someone else's, out of phase, a director's) folds under More.
  // An `arm: true` button arms on the first tap and fires on the second.
  const split = splitInteractions(session.view?.interactions ?? [], session.auth?.character ?? "", admin);
  const button = (i: Interaction): Action => interactionAction(i, arm, () => void session.act(i.id, guest.id));
  for (const i of split.mine) actions.push(button(i));
  const others: Action[] = split.more.map(button);
  if (admin && session.view?.legacyCapture) {
    actions.push(
      guest.captured
        ? { label: "🔓 Release", onClick: () => void session.moderate(guest.id, "release") }
        : { label: "🔒 Capture", onClick: () => void session.moderate(guest.id, "capture"), tone: "danger" },
    );
  }
  return (
    <>
      <Sheet
        title={
          <>
            <PersonAvatar name={guest.name} size="sm" /> {guest.name}
          </>
        }
        onClose={onClose}
        tall={actions.length > 5}
      >
        <div className="card-facts">
          <GroupPill group={guest.faction} />
          {where && <span className="pill">📍 {where}</span>}
          {guest.captured && <span className="pill">🔒 captured</span>}
          {guest.restricted && <span className="pill">⛔ restricted</span>}
          <span className="pill kind">{guest.id}</span>
        </div>
        <button className="choice" onClick={onOpenThread}>
          💬 Open their thread
        </button>
        <div className="sheet-h">As {session.auth?.character}</div>
        <div className="card-actions">
          <ActionRow actions={actions} />
        </div>
        {others.length > 0 && (
          <>
            <button className="link more-toggle" aria-expanded={more} onClick={() => setMore((v) => !v)}>
              {more ? "▾ Fewer" : `▸ More… (${others.length})`}
            </button>
            {more && (
              <div className="card-actions more">
                <ActionRow actions={others} />
              </div>
            )}
          </>
        )}
      </Sheet>
      {sharing && (
        <PickerSheet
          title={`Share with ${guest.name}…`}
          items={lore.map((e) => ({ id: e.id, label: e.title, sub: e.about ?? undefined }))}
          onPick={(id) => void session.shareCodex(id, guest.id)}
          onClose={() => setSharing(false)}
        />
      )}
    </>
  );
}
