//! The guest's sheets (moved out of `guest.tsx` in wave 13): the People
//! directory. (Wave 18: the dead profile sheet and identity card became the
//! Me sheet, `me.tsx`.)

import { Icon, IconTitle } from "../chrome/icons.tsx";
import { useState } from "react";
import { GroupPill, NameBadges, PersonAvatar, Sheet } from "../ui/primitives.tsx";
import { badgesOf } from "./wire.ts";
import type { GuestSession } from "../session/guest.ts";
import type { PersonCard } from "../types.ts";

/** One directory row: a name, a kind, where they are, and what you know of them. */
export function PersonRow({ card, onMessage }: { card: PersonCard; onMessage: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="people-row">
      <div className="people-top">
        <PersonAvatar name={card.name} size="sm" kind={card.kind} />
        {/* The name gets the whole line; its tags sit under it, so a phone
            never squeezes "Password Manager" down to "Pass…". */}
        <div className="people-id">
          <span className="people-name">
            <span className="name">{card.name}</span>
            <NameBadges badges={badgesOf(card)} />
          </span>
          <span className="people-tags">
            {card.faction && <GroupPill group={card.faction} />}
            {card.location && <span className="people-where">📍 {card.location}</span>}
          </span>
        </div>
        <button className="choice ghost" onClick={onMessage} aria-label={`Message ${card.name}`} title={`Message ${card.name}`}>
          <Icon name="reply" />
        </button>
      </div>
      {card.known.length > 0 && (
        <ul className="people-known">
          {card.known.map((e) => (
            <li key={e.id}>
              <button className="link" onClick={() => setOpen((v) => !v)}>
                {e.title}
              </button>
              {open && <p className="codex-text">{e.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The People directory — everyone here, by name, with limited info unless
 *  more has been shared with you. Message anyone privately. */
export function PeopleSheet({ session, only, onClose }: { session: GuestSession; only?: ReadonlySet<string>; onClose: () => void }) {
  const all = session.status?.people ?? [];
  const people = only ? all.filter((p) => only.has(p.id)) : all;
  const guests = people.filter((p) => p.kind === "guest");
  const cast = people.filter((p) => p.kind === "character");
  const open = (p: PersonCard) => {
    session.message({ id: p.id, kind: p.kind });
    onClose();
  };
  return (
    <Sheet title={<IconTitle icon="people">{only ? "Who's here" : "People"}</IconTitle>} onClose={onClose} tall>
      {people.length === 0 && <div className="codex-empty">{only ? "Nobody else is in this room." : "Nobody else is here yet."}</div>}
      {people.length > 0 && <div className="people-unknown">What your Codex holds about someone shows under their name. Tap the speech bubble to message them.</div>}
      {/* The other programs first — they are who a guest is looking for. */}
      {guests.length > 0 && <div className="codex-about">Guests</div>}
      {guests.map((p) => (
        <PersonRow key={p.id} card={p} onMessage={() => open(p)} />
      ))}
      {cast.length > 0 && <div className="codex-about">Characters</div>}
      {cast.map((p) => (
        <PersonRow key={p.id} card={p} onMessage={() => open(p)} />
      ))}
    </Sheet>
  );
}
