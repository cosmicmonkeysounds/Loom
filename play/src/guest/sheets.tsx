//! The guest's sheets (moved out of `guest.tsx` in wave 13): the profile
//! and pass, the People directory, and the identity card on the room list.

import { Icon, IconTitle } from "../chrome/icons.tsx";
import { useState } from "react";
import { ConnDot, connLabel, GroupPill, PersonAvatar, Sheet, WakeLockToggle } from "../ui/primitives.tsx";
import { PassQr } from "../pass-qr.tsx";
import { defectTargets, type GuestSession } from "../session/guest.ts";
import { withThe } from "../rooms/spaces.ts";
import { BalancePill } from "../wallet.tsx";
import type { PersonCard } from "../types.ts";
import type { Push } from "../push.ts";
import { PushRow } from "../push-card.tsx";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import { FullPass } from "../chrome/pass.tsx";
import { PictureChanger } from "./register.tsx";

/** Out-of-band actions: show your pass, the story's own interactions, switch
 *  sides, or leave. */
export function ProfileSheet({ session, push, onClose, onLeave }: { session: GuestSession; push: Push; onClose: () => void; onLeave: () => void }) {
  const faction = session.status?.faction ?? null;
  // One switch-sides button per other public group — driven by the story's
  // declared groups, not a baked-in pair; none while restricted.
  const others = defectTargets(session.status);
  // The story's `who: guest` INTERACTIONs — buttons the story itself declares
  // (an `arm: true` one arms on the first tap and fires on the second).
  const interactions = session.status?.interactions ?? [];
  const arm = useArmButtons();
  return (
    <Sheet title="Your pass" onClose={onClose}>
      {session.me && (
        <div className="pass">
          <PassQr alt="QR" text={session.me.id} />
          <div className="bigid">{session.me.id}</div>
          <div className="muted">Show this to a performer to be scanned.</div>
        </div>
      )}
      {session.me && <PictureChanger session={session} eventId={session.me.eventId} />}
      <WakeLockToggle />
      <PushRow push={push} />
      {interactions.length > 0 && <div className="sheet-h">Things you can do</div>}
      {interactions.map((i) => (
        <button
          key={i.id}
          className={`choice ${arm.armed === i.id ? "armed" : ""}`}
          title={i.description ?? undefined}
          aria-pressed={arm.armed === i.id || undefined}
          onClick={() =>
            arm.tap(i.id, i.arm, () => {
              onClose(); // the reply banners over the app, not behind the sheet
              void session.act(i.id, i.label).catch(() => {});
            })
          }
        >
          {i.label}
          {arm.armed === i.id && <span className="arm-line">{ARM_LINE}</span>}
        </button>
      ))}
      {faction &&
        others.map((other) => (
          <button key={other} className="choice ghost" onClick={() => void session.defect(other)}>
            Leave {withThe(faction)} for {withThe(other)}
          </button>
        ))}
      <button
        className="choice danger"
        onClick={() => {
          push.release();
          session.leave();
          onLeave();
        }}
      >
        Leave the event
      </button>
    </Sheet>
  );
}

/** Just the pass — the QR a performer scans — for when the app is on rails
 *  and the rest of the menu is out of reach. */
export function PassSheet({ me, onClose }: { me: { id: string; name: string }; onClose: () => void }) {
  return <FullPass guestId={me.id} name={me.name} onClose={onClose} />;
}

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
          <span className="name">{card.name}</span>
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

/** The identity card at the top of the sidebar: who you are, where you are. */
export function IdentityCard({ s, onPeople, onHelp, onProfile, onWallet, onScan }: { s: GuestSession; onPeople: () => void; onHelp: () => void; onProfile: () => void; onWallet: () => void; onScan: () => void }) {
  const st = s.status;
  const captured = st?.captured ?? false;
  const restricted = st?.restricted ?? false;
  const where = captured ? "🔒 captured" : restricted ? "⛔ restricted" : st?.location ? `📍 ${st.location}` : "📍 nowhere yet";
  return (
    <header className={`inbox-head ${captured ? "trapped" : ""} ${restricted ? "restricted" : ""}`}>
      <div className="me" data-tour="me">
        <PersonAvatar name={s.me?.name ?? "?"} />
        <div className="me-body">
          <div className="who">
            <strong>{s.me?.name}</strong> <GroupPill group={st?.faction ?? null} />
          </div>
          <div className="me-sub">
            <span>{where}</span>
            {st?.wallet ? <BalancePill view={st.wallet} onOpen={onWallet} /> : <span>⭐ {st?.score ?? 0}</span>}
            <ConnDot connected={s.connected} label={connLabel(s.connected)} />
          </div>
        </div>
      </div>
      <div className="hud">
        <button className="icon-btn" title="Scan a code on the wall" aria-label="Scan a code" onClick={onScan}>
          📷
        </button>
        <button className="icon-btn" title="People" onClick={onPeople} data-tour="people">
          👥
        </button>
        <button className="icon-btn" title="Help" onClick={onHelp} data-tour="help">
          ?
        </button>
        <button className="icon-btn" title="Your pass & settings" onClick={onProfile} data-tour="pass">
          ☰
        </button>
      </div>
    </header>
  );
}
