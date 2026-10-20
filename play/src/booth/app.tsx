//! The performer (character) app (moved out of `performer.tsx` in wave
//! 13) — the same chat shell as the guest, recomposed for the booth: every
//! room is theirs to run, every guest is a conversation, and everything a
//! performer can do to a guest lives on that guest's card.

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ActionRow, InviteSheet, PickerSheet, SessionEnded, useWide } from "../ui/primitives.tsx";
import { AlertBanner } from "../moments/banner.tsx";
import { Shell, SpaceList } from "../rooms/list.tsx";
import type { WidgetHook } from "../stream/bubble.tsx";
import { ChannelView, MessageThread } from "../stream/channel-view.tsx";
import { HelpSheet } from "../help.tsx";
import { usePlayHost } from "../host.ts";
import { WalletActionsProvider, useWalletClock } from "../wallet.tsx";
import { AvatarsContext, avatarLookup } from "../avatars.ts";
import { useDocumentTitle } from "../session/shared.ts";
import { INBOX, usePrimeSession } from "../session/prime.ts";
import type { Action, Channel } from "../types.ts";
import { usePush } from "../push.ts";
import { PushCard } from "../push-card.tsx";
import { opensHome } from "../room.ts";
import { activePins } from "../pins.ts";
import { GuestCard } from "./card.tsx";
import { BoothCard, PerformerSheet } from "./header.tsx";
import { PrimeLogin } from "./login.tsx";
import { ScannerScreen } from "./scanner.tsx";

/** The room a performer lands in wide: the broadcast feed. */
export function boothHome(list: Channel[]): string | null {
  return list.find((c) => c.id === "__feed")?.id ?? list[0]?.id ?? null;
}

export function PerformerApp({ onLeave }: { onLeave: () => void }) {
  const host = usePlayHost();
  const s = usePrimeSession();
  const wide = useWide();
  const [sheet, setSheet] = useState(false);
  const [help, setHelp] = useState(false);
  const [card, setCard] = useState<string | null>(null); // a guest id
  const [people, setPeople] = useState<Channel | null>(null);
  const [picking, setPicking] = useState(false);
  useDocumentTitle(s.auth?.title);
  // K-31a: the server-room (patch-bay) alarm + the late list on a locked phone.
  const push = usePush(s.auth?.character ? { base: `/e/${encodeURIComponent(s.auth.eventId)}`, token: s.auth.token } : null, "booth");
  // Everyone's profile pictures, for every tile in the booth.
  const avatars = useMemo(() => avatarLookup(s.auth?.eventId ?? null, s.view?.avatars), [s.auth?.eventId, s.view?.avatars]);
  const t = s.threads;
  const signedIn = s.auth !== null && s.ready;
  const activeId = t.activeId;
  const home = boothHome(t.list);
  // The approver's queue countdowns tick between snapshots, as the guest
  // wallet's do (a quiet stretch pushes no view).
  const walletClock = useWalletClock(s.view?.clock, s.view?.wallet);
  useEffect(() => {
    if (opensHome(signedIn, wide, activeId, home, s.roomLinkPending) && home !== null) t.open(home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, wide, activeId, home, s.roomLinkPending]);
  if (!s.auth) return host.embedded ? <SessionEnded notice={s.notice} /> : <PrimeLogin session={s} />;
  const admin = s.auth.admin;
  const guests = s.view?.guests ?? [];
  const guestByName = (name: string) => guests.find((g) => g.name === name || g.id === name) ?? null;
  const mod = admin ? { setHidden: (seq: number, hidden: boolean) => void s.setHidden(seq, hidden) } : undefined;
  // Cards the story deals to this character (`show … to <Character>`): the
  // booth answers them like a guest, through `/api/prime/widget`.
  const widgets: WidgetHook = { answer: (seq, r) => void s.answerWidget(seq, r).catch(() => {}), answered: s.widgetAnswers };
  const openCard = (name: string) => {
    const g = guestByName(name);
    if (g) setCard(g.id);
  };

  let stage: ReactElement | null = null;
  if (t.active) {
    const active = t.active;
    if (active.kind === "scanner") {
      stage = <ScannerScreen session={s} onBack={t.back} wide={wide} />;
    } else {
      // The broadcast feed posts to the room (lobby); guest threads keep their
      // id (the server maps `guest:<id>` to this character's DM with that guest).
      const postChannel = active.id === "__feed" ? "lobby" : active.id;
      if (t.activeThreadRoot !== null) {
        stage = (
          <MessageThread
            channel={active}
            rootSeq={t.activeThreadRoot}
            onClose={t.closeThread}
            moderate={mod}
            onSend={(text, parentSeq) => s.say(postChannel, text, parentSeq)}
          />
        );
      } else if (active.id === "quests" || active.id === "codex" || active.id === "wallet" || active.id === INBOX) {
        // The character's own pinned Quest Log / Codex / Wallet and its Inbox:
        // read-only rooms whose cards the booth answers (sharing stays on the
        // guest card; Approve / Deny live on the wallet cards).
        stage = (
          <ChannelView
            channel={active}
            wide={wide}
            onBack={t.back}
            moderate={mod}
            onOpenThread={t.openThread}
            widgets={widgets}
          />
        );
      } else if (active.kind === "guest") {
        const gid = active.id.slice("guest:".length);
        stage = (
          <ChannelView
            channel={active}
            wide={wide}
            onBack={t.back}
            showChannel
            moderate={mod}
            onOpenThread={t.openThread}
            onSend={(text) => s.say(active.id, text)}
            onPerson={openCard}
            pins={activePins(active.messages)}
            headerActions={
              <button className="icon-btn wide" title="What you can do with this guest" onClick={() => setCard(gid)}>
                ⚡ Actions
              </button>
            }
          />
        );
      } else if (active.id.startsWith("cast:")) {
        // A private line to an agent-voiced character (the server maps
        // `cast:<id>` onto its DM thread with this performer).
        stage = (
          <ChannelView
            channel={active}
            wide={wide}
            onBack={t.back}
            moderate={mod}
            onOpenThread={t.openThread}
            onSend={(text) => s.say(active.id, text)}
            widgets={widgets}
          />
        );
      } else {
        // An authored channel / a location room / the feed: post as the
        // character; a gated room can invite + leave.
        const gated = active.kind === "private" || active.kind === "group" || active.kind === "dm";
        const actions: Action[] = [];
        if (gated) actions.push({ label: "＋ Invite a guest", onClick: () => setPicking(true), tone: "primary" });
        if (gated && active.member) actions.push({ label: "🚪 Leave", onClick: () => void s.leaveChannel(active.id) });
        stage = (
          <ChannelView
            channel={active}
            wide={wide}
            onBack={t.back}
            moderate={mod}
            onOpenThread={t.openThread}
            onSend={(text) => s.say(postChannel, text)}
            onPerson={openCard}
            onPeople={() => setPeople(active)}
            pins={activePins(active.messages)}
            footer={actions.length > 0 ? <ActionRow actions={actions} /> : undefined}
          />
        );
      }
    }
  }

  const side = (
    <SpaceList
      spaces={t.spaces}
      activeId={t.activeId}
      onOpen={t.open}
      header={<BoothCard s={s} admin={admin} onHelp={() => setHelp(true)} onSheet={() => setSheet(true)} />}
      empty="No guests yet."
    />
  );
  const cardGuest = card !== null ? (guests.find((g) => g.id === card) ?? null) : null;

  return (
    <AvatarsContext.Provider value={avatars}>
    <WalletActionsProvider value={{ view: s.view?.wallet ?? null, me: null, clock: walletClock, approve: (id) => void s.walletApprove(id), deny: (id) => void s.walletDeny(id) }}>
    <div className="root">
      {s.alert && <AlertBanner text={s.alert.text} onDismiss={s.dismissAlert} />}
      <PushCard push={push} booth title={s.auth?.title} why="the server-room alarm and the late list reach you even with the phone locked." />
      <Shell side={side} stage={stage} wide={wide} placeholder="Pick a room, or a guest." />
      {picking && t.active && (
        <InviteSheet
          title={`Invite to ${t.active.title}`}
          people={guests.map((g) => ({ id: g.id, name: g.name }))}
          onPick={(id) => void s.inviteToChannel(id, t.active!.id)}
          onClose={() => setPicking(false)}
        />
      )}
      {people && (
        <PickerSheet
          title={`👥 In ${people.title}`}
          items={(people.people ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.group ?? undefined, avatar: true }))}
          onPick={(id) => setCard(id)}
          onClose={() => setPeople(null)}
          empty="Nobody is standing here."
        />
      )}
      {cardGuest && (
        <GuestCard
          session={s}
          guest={cardGuest}
          admin={admin}
          onClose={() => setCard(null)}
          onOpenThread={() => {
            setCard(null);
            t.open(`guest:${cardGuest.id}`);
          }}
        />
      )}
      {sheet && <PerformerSheet session={s} push={push} onClose={() => setSheet(false)} onLeave={onLeave} />}
      {help && <HelpSheet role="performer" onClose={() => setHelp(false)} />}
    </div>
    </WalletActionsProvider>
    </AvatarsContext.Provider>
  );
}
