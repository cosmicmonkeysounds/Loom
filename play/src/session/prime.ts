//! The performer (booth) session (moved out of `session.ts` in wave 13):
//! the booth's rooms and every booth action.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boothAlertFilter, unsolicitedReadout, useAlerts, type Alert, type Alerts } from "../alerts.ts";
import { ApiError, api, useChatStream, withTimeout } from "../client.ts";
import { shareErrorText } from "../codex.ts";
import { usePlayHost } from "../host.ts";
import { BOOTH_SIGNED_OUT, SessionRole, eventGone, lifecycleDropsSession, lifecycleNotice, lifecycleStartsNewRun, performerSessionDead } from "../lifecycle.ts";
import { locationOfRoom, occupantsByLocation, type Presence } from "../presence.ts";
import { CODEX_ROOM, PINNED_SPACE, QUEST_LOG, STORY_SPACE, WALLET_ROOM } from "../rooms/spaces.ts";
import { primeStreamUrl } from "../booth/model.ts";
import { roomOrder } from "../rooms/order.ts";
import { useThreads, type Threads } from "../rooms/threads-state.ts";
import { unreadOf } from "../stream/badges.ts";
import { questSummary } from "../stream/runs.ts";
import type { Channel, ChatMessage, GuestCardView, PrimeActResult, PrimeView, ScanResult } from "../types.ts";
import { useTyping } from "../typing.ts";
import { queueSummary } from "../wallet.tsx";
import type { WidgetResult } from "../widgets.tsx";
import { hasPendingCard } from "./channels.ts";
import { SAY_TIMEOUT_MS, sayRefusalText } from "./guest.ts";
import { NO_ANSWERS, tokenDead, useLandingBrand, usePerSession, useRoomLinks, useTheme, type ResolvedCode } from "./shared.ts";
import { primeStreamHandlers } from "./stream-handlers.ts";

export interface PrimeAuth {
  token: string;
  character: string;
  admin: boolean;
  /** The host capability (wave 13): the part is `admin: true` in the story.
   *  From `/api/prime/login`; absent on an older server or a stored sign-in. */
  host?: boolean;
  /** Which event this performer signed into. */
  eventId: string;
  /** The event's display title (from `/api/resolve-code`). */
  title?: string;
}

const PK = "loom.prime";

/** The booth's host capability: the latest view's when it says (a snapshot
 *  re-sends it on every path), else the sign-in's (C4). */
export function hostOf(viewHost: boolean | undefined, authHost: boolean | undefined): boolean {
  return (viewHost ?? authHost) === true;
}

/** The story's own rooms' section header in a booth (wave 18, G2). */
export const CHATS_TITLE = "Chats";

/** The sidebar section the staff rooms sit in (`rooms/spaces.ts SPACES.staff`). */
export const STAFF_SPACE = "staff";

const PRIME_ALERTS = "loom.prime.alerts";

// --- performer (character) --------------------------------------------------

/** The booth's Readouts room id (the old Inbox): the story's readouts to
 *  the character (`reply` lines, persisted as `dm:<me>` rows since wave 13)
 *  and the cards + notes it deals to it. */
export const INBOX = "__inbox";

/** Build the performer's surfaces: a scanner, the character's Readouts
 *  (readouts + cards the story deals to it), the broadcast feed, the
 *  character's own pinned Quest Log / Codex, the staff rooms (pinned just
 *  under them), the rooms, the cast threads, and one conversation per guest
 *  (targeted messages, for moderation). The scanner and the guest threads
 *  stay reachable (a link, a card) but out of the sidebar (`boothSidebar`).
 *  `answered` = the cards this booth has answered (a pending one bubbles
 *  its room up). */
export function buildPrimeChannels(messages: Map<number, ChatMessage>, view: PrimeView | null, answered: ReadonlySet<number> = new Set<number>()): Channel[] {
  const all = [...messages.values()];
  const bySeq = (a: ChatMessage, b: ChatMessage) => a.seq - b.seq;
  const occupants = occupantsByLocation(view?.guests ?? [], null);
  const locationLabel = (loc: string | null): string | null => {
    if (loc === null) return null;
    return view?.channels.find((c) => c.id === `loc:${loc}`)?.title ?? loc;
  };
  const scanner: Channel = {
    id: "__scanner",
    kind: "scanner",
    title: "Scanner",
    subtitle: "scan a guest's pass",
    spaceId: "booth", // the booth tools group apart from the room + guests
    order: 0,
    messages: [],
    unread: 0,
    decision: null,
    lastTs: Number.MAX_SAFE_INTEGER, // pinned to the top
  };
  const me = view?.character ?? "";
  // The feed is the house's broadcast: never a DM thread (a host booth's
  // stream also carries guests' Trabolta threads, for answering as him).
  const feedMsgs = all.filter((m) => m.audience === "all" && !m.channel.startsWith("dm:")).sort((a, b) => a.seq - b.seq);
  const everyone: Presence[] = (view?.guests ?? []).map((g) => ({ id: g.id, name: g.name, kind: "guest" as const, group: g.faction }));
  const feed: Channel = {
    id: "__feed",
    kind: "lobby",
    // The far-away Chat log (wave 18, G2; NM-F6): never the story's title.
    title: "Chat log",
    subtitle: "everything the house said tonight",
    spaceId: STORY_SPACE,
    // Wave 18 (BOOTH-SPEC §3): the rooms list's section reads "Chats", never the story title.
    spaceTitle: CHATS_TITLE,
    order: 0,
    people: everyone,
    messages: feedMsgs,
    unread: 0,
    decision: null,
    lastTs: feedMsgs.length ? feedMsgs[feedMsgs.length - 1]!.ts : 0,
  };
  const guests: Channel[] = (view?.guests ?? []).map((g) => {
    const msgs = all
      .filter((m) => Array.isArray(m.audience) && m.audience.includes(g.id))
      .sort((a, b) => a.seq - b.seq);
    const where = locationLabel(g.location);
    return {
      id: `guest:${g.id}`,
      kind: "guest" as const,
      title: g.name,
      subtitle: `${g.faction ?? "unaligned"}${where ? ` · 📍 ${where}` : ""}${g.captured ? " · 🔒 captured" : ""}${g.restricted ? " · ⛔ restricted" : ""}`,
      spaceId: "guests", // one section of per-guest conversations
      order: 0,
      people: [{ id: g.id, name: g.name, kind: "guest" as const, group: g.faction }],
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    };
  });
  // Authored channels (SPACE/CHANNEL) the performer runs — grouped by space.
  const spaceTitles = new Map((view?.spaces ?? []).map((s) => [s.id, s.title]));
  // The staff rooms (`# hosts`, `# quarantine`) sit just under Pinned: the
  // rooms every performer is told to watch never hide in the house's list.
  const staff = new Set(view?.staffRooms ?? []);
  const rooms: Channel[] = (view?.channels ?? []).map((c) => {
    const msgs = all.filter((m) => m.channel === c.id).sort((a, b) => a.seq - b.seq);
    const isStaff = staff.has(c.id);
    return {
      id: c.id,
      kind: c.kind as Channel["kind"],
      title: c.title,
      spaceId: isStaff ? STAFF_SPACE : c.spaceId,
      ...(isStaff ? { staff: true as const, subtitle: "staff only" } : {}),
      spaceTitle: isStaff ? undefined : c.spaceId === STORY_SPACE ? CHATS_TITLE : spaceTitles.get(c.spaceId),
      member: c.member,
      canPost: c.canPost,
      threadable: c.threadable,
      ...(locationOfRoom(c.id) !== null ? { people: occupants.get(locationOfRoom(c.id)!) ?? [] } : {}),
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    };
  });
  // Agent-voiced characters (`mind: external`) the performer can talk to
  // privately: the agent's `dm:` channel, narrowed to this performer
  // (audience `@<me>`). The server maps a post to `cast:<id>` onto it.
  const mine = (m: ChatMessage): boolean => Array.isArray(m.audience) && m.audience.includes(`@${me}`);
  const cast: Channel[] = (view?.agents ?? []).map((a) => {
    const msgs = all
      .filter((m) => m.channel === `dm:${a.id}` && mine(m))
      .sort(bySeq);
    return {
      id: `cast:${a.id}`,
      kind: "dm" as const,
      title: a.id,
      subtitle: a.online ? "online" : "away — answers when their agent is back",
      spaceId: "cast",
      spaceTitle: "Cast",
      order: 0,
      people: [{ id: a.id, name: a.id, kind: "character" as const, group: null }],
      messages: msgs,
      unread: 0,
      decision: null,
      needsYou: hasPendingCard(msgs, answered),
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    };
  });
  // The character's own pinned rooms: its Quest Log (`start quest X for
  // <Character>`) and Codex (what it knows), addressed `@<me>` — read-only
  // (a booth types no codes; sharing stays on the guest card).
  const pinned: Channel[] = [];
  if ((view?.questTotal ?? 0) > 0) {
    const msgs = all.filter((m) => m.channel === QUEST_LOG && mine(m)).sort(bySeq);
    pinned.push({
      id: QUEST_LOG,
      kind: "quests",
      title: "Quest Log",
      subtitle: questSummary(view?.quests ?? []),
      spaceId: PINNED_SPACE,
      order: 0,
      canPost: false,
      threadable: true,
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    });
  }
  if ((view?.codexTotal ?? 0) > 0) {
    const msgs = all.filter((m) => m.channel === CODEX_ROOM && mine(m)).sort(bySeq);
    pinned.push({
      id: CODEX_ROOM,
      kind: "codex",
      title: "Codex",
      subtitle: `${view?.codex?.length ?? 0} of ${view?.codexTotal ?? 0} found`,
      spaceId: PINNED_SPACE,
      order: 1,
      canPost: false,
      threadable: false,
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    });
  }
  // The approver's Wallet room: the held / pending transfers waiting on
  // this character, as `@<me>` cards — Approve / Deny live on the cards.
  if (view?.wallet !== undefined) {
    const msgs = all.filter((m) => m.channel === WALLET_ROOM && mine(m)).sort(bySeq);
    pinned.push({
      id: WALLET_ROOM,
      kind: "wallet",
      title: "Wallet",
      subtitle: queueSummary(view.wallet),
      spaceId: "booth",
      order: -1,
      canPost: false,
      threadable: true,
      needsYou: view.wallet.queue.some((t) => t.state === "held"),
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: Number.MAX_SAFE_INTEGER - 1,
    });
  }
  // Readouts: what the story told this character (`reply` lines, which the
  // server keeps as `dm:<me>` rows since wave 13, so they survive a reload)
  // and the cards + notes it deals to it (`show <kind> … to <Character>`
  // with no thread) — `dm:<me>` rows addressed `@<me>`. A card still
  // waiting on the booth bubbles it up.
  const inboxMsgs = all.filter((m) => m.channel === `dm:${me}` && mine(m)).sort(bySeq);
  const lastReadout = [...inboxMsgs].reverse().find((m) => m.readout === true);
  const inbox: Channel = {
    id: INBOX,
    kind: "dm",
    title: "Readouts",
    subtitle: lastReadout !== undefined ? lastReadout.text : "what your scans and buttons said",
    spaceId: "booth",
    order: 1,
    messages: inboxMsgs,
    unread: 0,
    decision: null,
    needsYou: hasPendingCard(inboxMsgs, answered),
    lastTs: inboxMsgs.length ? inboxMsgs[inboxMsgs.length - 1]!.ts : 0,
  };
  return [scanner, inbox, feed, ...pinned, ...rooms, ...cast, ...guests];
}

export interface PrimeSession {
  auth: PrimeAuth | null;
  view: PrimeView | null;
  /** The alert that just landed — a `!` broadcast, or a readout the booth
   *  didn't ask for (the late list, a private warning) — until dismissed. */
  alert: Alert | null;
  dismissAlert: () => void;
  /** The session's whole `useAlerts` state (wave 13: the moments layer reads it). */
  alerts: Alerts;
  /** Every message delivered to this booth, by seq (wave 13: the moments layer reads it). */
  messages: ReadonlyMap<number, ChatMessage>;
  connected: boolean;
  /** The backlog has loaded — the rooms list is real, not a placeholder. */
  ready: boolean;
  /** Why the last sign-in ended under us (the show went live / the run
   *  ended) — shown on the sign-in screen until the performer signs in again. */
  notice: string | null;
  threads: Threads;
  login: (character: string, passcode: string) => Promise<void>;
  /** Scan a guest's pass (`/api/scan`); the answer carries the guest's card (wave 13). */
  scan: (target: string) => Promise<ScanResult>;
  /** What this booth may do to one guest right now (`/api/prime/card`, wave 13). */
  card: (guest: string) => Promise<GuestCardView>;
  /** Hybrid chat: type into a channel as this character (reply via parentSeq). */
  say: (channel: string, text: string, parentSeq?: number) => Promise<unknown>;
  /** Access control: pull a guest into a membership-gated channel. */
  inviteToChannel: (person: string, channel: string) => Promise<unknown>;
  /** Leave a membership-gated channel. */
  leaveChannel: (channel: string) => Promise<unknown>;
  becomeAdmin: (passcode: string) => Promise<void>;
  /** Fire a performer / admin interaction on a guest, as this character —
   *  or (C4, wave 18) a global one with no guest. */
  act: (name: string, guest?: string | null) => Promise<PrimeActResult>;
  /** A caller booth's own cue (C8, wave 18): `/api/prime/cue`, the cue-sheet path
   *  (409 `moved` / `doorsClosed`, `refused`). */
  cue: (name: string, subject: string | null, args: Record<string, unknown> | null, presses: number | undefined, signal?: AbortSignal) => Promise<{ refused?: boolean; moved?: boolean; said?: string[]; staff?: string[] }>;
  /** Codex: hand one of the character's entries to a guest. */
  shareCodex: (entry: string, to: string) => Promise<unknown>;
  /** The approver's booth: settle a held transfer / deny one in its window. */
  walletApprove: (id: string) => Promise<unknown>;
  walletDeny: (id: string) => Promise<unknown>;
  moderate: (id: string, action: string, name?: string) => Promise<unknown>;
  setHidden: (seq: number, hidden: boolean) => Promise<unknown>;
  /** Answer a card the story dealt to this character (`show … to <Character>`). */
  answerWidget: (seq: number, result: WidgetResult) => Promise<void>;
  /** Cards (by seq) this booth has answered — rendered resolved, never re-asked. */
  widgetAnswers: ReadonlyMap<number, WidgetResult>;
  leave: () => void;
  /** A notification's room link is waiting to open (SW-PLAY-20). */
  roomLinkPending: boolean;
}

export function usePrimeSession(): PrimeSession {
  const host = usePlayHost();
  const { load, save, drop } = host.storage;
  const crawl = host.crawl;
  const [auth, setAuth] = useState<PrimeAuth | null>(() => {
    const stored = load<PrimeAuth>(PK);
    if (stored && !stored.eventId) stored.eventId = "default"; // migrate pre-multi-event sessions
    return stored;
  });
  const [view, setView] = useState<PrimeView | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const base = auth ? `/e/${encodeURIComponent(auth.eventId)}` : "";
  // The stream's character identity comes from the token server-side; the
  // token rides the URL because EventSource can't set headers. The
  // capabilities ride it too: the server fixes what a booth sees at
  // connect, so gaining admin or host reopens the stream.
  const url = primeStreamUrl(base, auth);
  /** The booth's sign-in is gone (the show went live / the run ended). */
  const dropBooth = useCallback((why: string | null) => {
    drop(PK);
    setAuth(null);
    setView(null);
    setReady(false);
    setNotice(why);
    host.onEnded("prime", why);
  }, [drop, host]);
  const { typing, onTyping } = useTyping(auth !== null ? { role: "performer", character: auth.character } : null);
  // Booths get the guest's alerts (alerts.ts) plus N-07: a readout that
  // isn't the answer to this booth's own scan / act — the late list,
  // a character's warning from Trabolta — banners and chimes too.
  const alertsRef = useRef<ReturnType<typeof useAlerts> | null>(null);
  const lastActionAt = useRef(Number.NEGATIVE_INFINITY);
  /** The booth's own requests in flight: a readout while one is pending is
   *  its answer, however slow the network (a scan on cellular). */
  const inFlight = useRef(0);
  const { messages, connected } = useChatStream(url, {
    onSnapshot: (v) => setView(v as PrimeView),
    onTyping,
    // The crawl decides at arrival (wave 13: a no-op until the stream lane)
    // and the backlog sets its baseline (stream-handlers.ts).
    ...primeStreamHandlers(crawl, auth, (list) => {
      alertsRef.current?.onHistory(list);
      setReady(true);
    }),
    // The readout itself lands as a `dm:<me>` row (Readouts, and the card
    // that caused it); the frame only decides whether it banners.
    onResponse: (text) => {
      if (inFlight.current === 0 && unsolicitedReadout(lastActionAt.current, Date.now())) alertsRef.current?.raise(text);
    },
    // Going live signs every performer out (rehearsal booths must not carry
    // into the show); a reset / reload keeps the character — the server just
    // re-sends the snapshot + history, which is then old news for alerts.
    onLifecycle: (n) => {
      if (lifecycleDropsSession(n.kind, SessionRole.Performer)) dropBooth(lifecycleNotice(n.kind, SessionRole.Performer));
      else {
        // B5: last run's answered cards are not tonight's (its readouts go
        // with the old history: the server re-sends tonight's).
        if (lifecycleStartsNewRun(n.kind)) setWidgetAnswers(() => NO_ANSWERS);
        alertsRef.current?.rebase();
      }
    },
    // The stream closed for good: confirm the booth's token is really gone
    // (released, or the show went live while the phone slept) before
    // signing out — anything else (a restart behind the proxy) reopens it.
    probe: () => (auth === null ? Promise.resolve(null) : tokenDead(base, "prime", auth.token)),
    onDead: (dead) => {
      if (dead) dropBooth(dead === "ended" ? lifecycleNotice("ended", SessionRole.Performer) : BOOTH_SIGNED_OUT);
    },
  });

  // Every action is scoped to the event this performer signed into. A 403
  // "sign in" answer means the token lost its character (a release, or a
  // go-live while this phone wasn't listening) — drop the booth and say so.
  const post = useCallback(
    async <T,>(path: string, body?: unknown, token?: string): Promise<T> => {
      lastActionAt.current = Date.now();
      inFlight.current++;
      try {
        return await api<T>(`${base}${path}`, body, token);
      } catch (e) {
        if (e instanceof ApiError && auth !== null) {
          if (eventGone(e.status, e.message)) dropBooth(lifecycleNotice("ended", SessionRole.Performer));
          else if (performerSessionDead(e.status, e.message)) dropBooth(BOOTH_SIGNED_OUT);
        }
        throw e;
      } finally {
        inFlight.current--;
        lastActionAt.current = Date.now(); // the grace runs from the answer too
      }
    },
    [base, auth, dropBooth],
  );

  const login = useCallback(async (character: string, passcode: string) => {
    // Resolve the performer/mod code to its event, then sign in there.
    const { eventId, title } = await api<ResolvedCode>("/api/resolve-code", { code: passcode });
    const r = await api<{ token: string; character: string; admin: boolean; host?: boolean }>(
      `/e/${encodeURIComponent(eventId)}/api/prime/login`,
      { character, passcode },
    );
    const a: PrimeAuth = { token: r.token, character: r.character, admin: !!r.admin, host: r.host === true, eventId, title };
    crawl.reset();
    save(PK, a);
    setAuth(a);
    setNotice(null);
  }, []);
  // C4: the host capability rides every snapshot (`PrimeView.host`), so a
  // booth signed in before the story marked its part `admin: true` (or
  // before a reload / restart / the Players seat) becomes a host from the
  // latest view (`view.host ?? auth.host`), without signing in again. The
  // stored sign-in follows, so a reload keeps it; the stream reopens with
  // the host capability (`primeStreamUrl`).
  const viewHost = view?.host;
  useEffect(() => {
    if (auth === null) return;
    const next = hostOf(viewHost, auth.host);
    if (next === (auth.host === true)) return;
    const a: PrimeAuth = { ...auth, host: next };
    save(PK, a);
    setAuth(a);
  }, [viewHost, auth, save]);
  const scan = useCallback((target: string) => post<ScanResult>("/api/scan", { target }, auth!.token), [post, auth]);
  // A read, not an action: it never counts as the booth's own request, so a
  // readout landing while a card opens still banners (N-07).
  const card = useCallback(
    async (guest: string): Promise<GuestCardView> => {
      try {
        return await api<GuestCardView>(`${base}/api/prime/card`, { guest }, auth!.token);
      } catch (e) {
        if (e instanceof ApiError && auth !== null) {
          if (eventGone(e.status, e.message)) dropBooth(lifecycleNotice("ended", SessionRole.Performer));
          else if (performerSessionDead(e.status, e.message)) dropBooth(BOOTH_SIGNED_OUT);
        }
        throw e;
      }
    },
    [base, auth, dropBooth],
  );
  // A refused line banners why and rejects, so the composer keeps the text.
  const say = useCallback(
    async (channel: string, text: string, parentSeq?: number) => {
      try {
        return await withTimeout(post("/api/prime/say", { channel, text, parentSeq }, auth!.token), SAY_TIMEOUT_MS);
      } catch (e) {
        const why = sayRefusalText(e);
        if (why !== null) alertsRef.current?.raise(why, { quiet: true });
        throw e;
      }
    },
    [post, auth],
  );
  const inviteToChannel = useCallback(
    (person: string, channel: string) => post("/api/prime/channel/invite", { person, channel }, auth!.token),
    [post, auth],
  );
  const leaveChannel = useCallback(
    (channel: string) => post("/api/prime/channel/leave", { channel }, auth!.token),
    [post, auth],
  );
  const becomeAdmin = useCallback(
    async (passcode: string) => {
      const r = await api<{ token: string }>(`${base}/api/mod/login`, { passcode }, auth!.token);
      const a: PrimeAuth = { ...auth!, token: r.token, admin: true };
      save(PK, a);
      setAuth(a);
    },
    [base, auth],
  );
  const act = useCallback(
    (name: string, guest?: string | null) => post<PrimeActResult>("/api/prime/act", guest != null && guest !== "" ? { name, guest } : { name }, auth!.token),
    [post, auth],
  );
  const cue = useCallback(
    (name: string, subject: string | null, args: Record<string, unknown> | null, presses: number | undefined) =>
      post<{ refused?: boolean; moved?: boolean; said?: string[]; staff?: string[] }>(
        "/api/prime/cue",
        { name, ...(subject !== null ? { subject } : {}), ...(args !== null ? { args } : {}), ...(presses !== undefined ? { presses } : {}) },
        auth!.token,
      ),
    [post, auth],
  );
  const shareCodex = useCallback(
    async (entry: string, to: string): Promise<unknown> => {
      try {
        return await post("/api/prime/codex/share", { entry, to }, auth!.token);
      } catch (e) {
        const why = shareErrorText(e);
        if (why !== null) alertsRef.current?.raise(why, { quiet: true });
        return null;
      }
    },
    [post, auth],
  );
  const moderate = useCallback(
    (id: string, action: string, name?: string) => post("/api/mod/act", { id, action, name }, auth!.token),
    [post, auth],
  );
  const walletCall = useCallback(
    async (sub: "approve" | "deny", id: string): Promise<unknown> => {
      try {
        return await post(`/api/prime/wallet/${sub}`, { id }, auth!.token);
      } catch (e) {
        if (e instanceof ApiError) {
          alertsRef.current?.raise(e.message, { quiet: true });
          return null;
        }
        throw e;
      }
    },
    [post, auth],
  );
  const walletApprove = useCallback((id: string) => walletCall("approve", id), [walletCall]);
  const walletDeny = useCallback((id: string) => walletCall("deny", id), [walletCall]);
  const setHidden = useCallback(
    (seq: number, hidden: boolean) => post("/api/mod/message", { seq, hidden }, auth!.token),
    [post, auth],
  );
  // Cards dealt to this character: one answer per card. The server refuses
  // a second (409); the snapshot lists the cards already answered so a
  // reload renders them resolved (an empty record marks each).
  // Held per sign-in like the guest's (B2): Go live, End and a dead token
  // drop the booth, the performer signs in again under a new token, and the
  // new run hands out the old run's seqs — last run's answers read empty.
  const [widgetAnswers, setWidgetAnswers] = usePerSession(auth?.token ?? null, NO_ANSWERS);
  const answeredList = view?.answered;
  useEffect(() => {
    if (answeredList === undefined || answeredList.length === 0) return;
    setWidgetAnswers((prev) => {
      if (answeredList.every((seq) => prev.has(seq))) return prev;
      const next = new Map(prev);
      for (const seq of answeredList) if (!next.has(seq)) next.set(seq, {});
      return next;
    });
  }, [answeredList]);
  const answerWidget = useCallback(
    async (seq: number, result: WidgetResult) => {
      setWidgetAnswers((prev) => new Map(prev).set(seq, result));
      try {
        await post("/api/prime/widget", { seq, result }, auth!.token);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) {
          setWidgetAnswers((prev) => {
            const next = new Map(prev);
            next.delete(seq);
            return next;
          });
        }
        throw e;
      }
    },
    [post, auth],
  );
  const leave = useCallback(() => {
    // Sign out frees the part on the server too, so the same performer can
    // sign in from another phone (the iPhone Home Screen icon) without a
    // director's ⏏ Release. Fire-and-forget: signing out never waits.
    if (auth !== null) void api(`${base}/api/prime/logout`, {}, auth.token).catch(() => {});
    drop(PK);
    setAuth(null);
    setView(null);
    setReady(false);
    setNotice(null);
    host.onEnded("prime", null);
  }, [drop, host, auth, base]);

  const boothFilter = useMemo(() => (auth !== null ? boothAlertFilter(auth.character) : undefined), [auth]);
  const alerts = useAlerts({
    messages,
    clock: view?.clock,
    session: auth?.token ?? null,
    storage: host.storage,
    storageKey: PRIME_ALERTS,
    sound: host.sound,
    // B1: never a guest's own `!` (the booth holds every guest's lobby lines).
    forMe: boothFilter,
  });
  alertsRef.current = alerts;
  const threads = useThreads(
    buildPrimeChannels(messages, view, new Set(widgetAnswers.keys())).map((c) => (typing.has(c.id) ? { ...c, typing: typing.get(c.id) } : c)),
    undefined,
    { me: auth !== null ? { id: auth.character, name: auth.character, booth: true } : undefined, unread: unreadOf, order: roomOrder },
  );
  const roomLinkPending = useRoomLinks(threads, auth !== null && ready && view !== null, true);
  const landing = useLandingBrand();
  useTheme(auth === null ? landing.theme : view?.theme);
  return { auth, view, alert: alerts.alert, dismissAlert: alerts.dismiss, alerts, messages, connected, ready, notice, threads, login, scan, card, say, inviteToChannel, leaveChannel, becomeAdmin, act, cue, shareCodex, walletApprove, walletDeny, moderate, setHidden, answerWidget, widgetAnswers, leave, roomLinkPending };
}
