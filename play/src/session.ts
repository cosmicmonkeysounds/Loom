//! Role sessions. Each opens the SSE stream for its participant (via
//! `useChatStream`), keeps the authoritative status snapshot, exposes the
//! role's actions, and composes the live message map into conversation
//! threads (`useThreads`). The guest and performer both build on the same
//! plumbing — only their channel-shaping + actions differ.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, useChatStream } from "./client.ts";
import { maxSeqOf, pickAlerts, playChime, pmChannelId, pmOtherParty, unlockFromSearch, vibrate, withoutUnlock } from "./codex.ts";
import { usePlayHost } from "./host.ts";
import { SessionRole, guestSessionDead, lifecycleDropsSession, lifecycleNotice, performerSessionDead } from "./lifecycle.ts";
import { locationOfRoom, occupantsByLocation, type Presence } from "./presence.ts";
import { STORY_SPACE, channelHead, groupByChannel, prettyName, useThreads, type Threads } from "./threads.ts";
import { useTyping } from "./typing.ts";
import type { Channel, ChatMessage, Decision, GuestView, PrimeView } from "./types.ts";
import { WIDGETS, type WidgetResult } from "./widgets.tsx";

// --- persistence ------------------------------------------------------------

interface GuestId {
  id: string;
  name: string;
  /** The capability token registration minted — authorizes every guest call.
   *  The public `id` is broadcast in rosters, so it is NOT a credential. */
  token: string;
  /** Which event this guest joined — every call is scoped to `/e/:eventId`. */
  eventId: string;
  /** The event's display title (from `/api/resolve-code`). */
  title?: string;
}
interface PrimeAuth {
  token: string;
  character: string;
  admin: boolean;
  /** Which event this performer signed into. */
  eventId: string;
  /** The event's display title (from `/api/resolve-code`). */
  title?: string;
}

/** What `/api/resolve-code` answers for any valid passcode. */
export interface ResolvedCode {
  eventId: string;
  role: string;
  title?: string;
  /** A performer / mod code lists the characters one may sign in as. */
  characters?: string[];
}

/** Resolve a passcode (null if unknown/invalid). The join screens use it to
 *  show what a scanned QR leads into and, for a performer, whom they can be. */
export async function resolveCode(code: string): Promise<ResolvedCode | null> {
  try {
    return await api<ResolvedCode>("/api/resolve-code", { code });
  } catch {
    return null;
  }
}

/** Resolve a passcode to its event's display title (null if unknown/invalid). */
export async function resolveEventTitle(code: string): Promise<string | null> {
  return (await resolveCode(code))?.title ?? null;
}

/**
 * Is this token still good? Asked before dropping a session over a closed
 * stream — a closed `EventSource` is also what a flaky network, a sleeping
 * phone, or a mid-restart server produces, and none of those should log a
 * guest out. Only a definite 401 / 403 from the server means dead.
 */
async function tokenDead(base: string, role: "guest" | "prime", token: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/state?role=${role}`, { headers: { "x-loom-token": token } });
    return res.status === 401 || res.status === 403;
  } catch {
    return false; // no answer at all: the server is away, not the session
  }
}

/** The event code can ride in on a `?code=` link (e.g. a scanned QR). */
export function codeFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("code") ?? "";
  } catch {
    return "";
  }
}

/** The event title for a `?code=` join link, once resolved (else null). */
export function useUrlEventTitle(): string | null {
  const { ownsPage } = usePlayHost();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!ownsPage) return;
    const code = codeFromUrl();
    if (code === "") return;
    let alive = true;
    void resolveEventTitle(code).then((t) => {
      if (alive && t !== null) setTitle(t);
    });
    return () => {
      alive = false;
    };
  }, [ownsPage]);
  return title;
}

/** Keep the browser tab named after the event once we know its title. */
export function useDocumentTitle(title: string | null | undefined): void {
  const { ownsPage } = usePlayHost();
  useEffect(() => {
    if (ownsPage && title) document.title = title;
  }, [ownsPage, title]);
}

/**
 * The story's `theme:` becomes `data-theme` on the root element — the
 * stylesheet's neutral skin is the default; `aol97` is the 1997 chat-room
 * look one particular party shipped with (see `styles.css`).
 */
export function useTheme(theme: string | null | undefined): void {
  const host = usePlayHost();
  useEffect(() => {
    const el = host.themeRoot();
    if (el === null) return;
    if (theme && theme !== "plain") el.dataset["theme"] = theme;
    else delete el.dataset["theme"];
  }, [host, theme]);
}
const GK = "loom.guest";
const PK = "loom.prime";

// --- guest ------------------------------------------------------------------

/** The one required decision (if any), and the channel it should dock under. */
function requiredDecision(
  status: GuestView | null,
  acts: { choose: (i: number) => void; join: (f: string) => void; escape: () => void },
): { channel: string; decision: Decision } | null {
  if (!status) return null;
  if (status.pendingChoice) {
    return {
      channel: status.decisionChannel ?? "lobby",
      decision: {
        title: "Your move…",
        options: status.pendingChoice.map((opt, i) => ({ label: opt, onClick: () => acts.choose(i) })),
      },
    };
  }
  // The side chooser is driven by the story's declared public factions —
  // nothing is shown for a story that has none.
  const factions = status.factions ?? [];
  if (!status.faction && !status.captured && factions.length > 0) {
    return {
      channel: "lobby",
      decision: {
        title: "Choose your side",
        options: factions.map((f, i) => ({
          label: `Side with the ${f}`,
          onClick: () => acts.join(f),
          tone: i === 0 ? undefined : ("ghost" as const),
        })),
      },
    };
  }
  // A captive may break out from the app — unless their prison is sealed
  // (the story lets them out: a performer, a puzzle, a VR goose).
  if (status.captured && status.canEscape !== false) {
    return {
      channel: "lobby",
      decision: {
        title: "You've been captured",
        options: [{ label: "🏃 Make a break for it", onClick: () => acts.escape(), tone: "danger" }],
      },
    };
  }
  return null;
}

/** An alert broadcast that just landed — chime, buzz, banner. */
export interface Alert {
  seq: number;
  text: string;
}

/** Group the guest's messages into threads, docking the pending decision, and
 *  merge in authored channels (SPACE/CHANNEL) the guest can see — including
 *  empty rooms — from the server snapshot. */
export function buildGuestChannels(
  messages: Map<number, ChatMessage>,
  dock: { channel: string; decision: Decision } | null,
  view: GuestView | null,
  opened: ReadonlySet<string> = new Set(),
  answered: ReadonlySet<number> = new Set(),
): Channel[] {
  const groups = groupByChannel(messages);
  // Who stands where — the sidebar's "3 here" and the room header's strip.
  const occupants = occupantsByLocation(
    view?.people ?? [],
    view ? { id: view.id, name: view.name, group: view.faction, location: view.location } : null,
  );
  const everyone: Presence[] = view
    ? [
        { id: view.id, name: view.name, kind: "guest", group: view.faction },
        ...(view.people ?? []).filter((p) => p.kind === "guest").map((p) => ({ id: p.id, name: p.name, kind: "guest" as const, group: p.faction })),
      ]
    : [];
  const presenceOf = (id: string): { here?: boolean; people?: Presence[] } => {
    const loc = locationOfRoom(id);
    if (loc !== null) return { here: view?.location === loc, people: occupants.get(loc) ?? [] };
    if (id.startsWith("dm:")) return { people: [{ id: id.slice(3), name: id.slice(3), kind: "character", group: null }] };
    if (id === "lobby") return { people: everyone };
    return {};
  };
  // A card still waiting on this guest (an answerable widget with no answer
  // in this session) pulls its room to the top, like a decision does.
  const needsYou = (msgs: ChatMessage[]): boolean =>
    msgs.some((m) => m.kind === "widget" && m.widget !== undefined && (WIDGETS[m.widget.kind]?.answerable ?? false) && !answered.has(m.seq));
  if (!groups.has("lobby")) groups.set("lobby", []); // the lobby is always present
  if (dock && !groups.has(dock.channel)) groups.set(dock.channel, []);
  // Threads the guest opened from the People list (a private message to a
  // guest, a DM to a character) exist before anyone has said anything.
  for (const id of opened) if (!groups.has(id)) groups.set(id, []);
  const spaceTitles = new Map((view?.spaces ?? []).map((s) => [s.id, s.title]));
  const snap = new Map((view?.channels ?? []).map((c) => [c.id, c]));
  for (const id of snap.keys()) if (!groups.has(id)) groups.set(id, []); // empty authored rooms
  // The story's own section is named after the story, whichever channel
  // (derived or authored) happens to lead it.
  const storyTitle = view?.title ?? spaceTitles.get(STORY_SPACE);
  const titleOfSpace = (spaceId: string) => (spaceId === STORY_SPACE ? storyTitle : spaceTitles.get(spaceId));
  return [...groups.entries()].map(([id, msgs]) => {
    const lastTs = msgs.length ? msgs[msgs.length - 1]!.ts : 0;
    const decision = dock && dock.channel === id ? dock.decision : null;
    const s = snap.get(id);
    if (s !== undefined) {
      // An authored channel — title/kind/space are server-authoritative.
      return {
        id,
        kind: s.kind as Channel["kind"],
        title: s.title,
        spaceId: s.spaceId,
        spaceTitle: titleOfSpace(s.spaceId),
        needsYou: needsYou(msgs),
        member: s.member,
        canPost: s.canPost,
        threadable: s.threadable,
        ...presenceOf(id),
        messages: msgs,
        unread: 0,
        decision,
        lastTs,
      };
    }
    // A derived channel — read title/kind from the id (`dm:Recruiter` → "Recruiter").
    // The lobby is named after the story; derived rooms live in the story's space.
    // A private thread is named after the other party.
    const head = channelHead(id);
    const other = view ? pmOtherParty(id, view.id) : null;
    const otherName =
      other !== null
        ? (view?.people?.find((p) => p.id === other)?.name ?? view?.roster.find((p) => p.id === other)?.name ?? prettyName(other))
        : null;
    return {
      id,
      kind: head.kind,
      title: otherName ?? (head.kind === "lobby" && storyTitle ? storyTitle : head.title),
      subtitle: otherName !== null ? "private" : undefined,
      spaceId: STORY_SPACE,
      spaceTitle: storyTitle,
      needsYou: needsYou(msgs),
      order: head.kind === "lobby" ? 0 : head.kind === "faction" ? 1 : 2,
      ...(otherName !== null && other !== null ? { people: [{ id: other, name: otherName, kind: "guest" as const, group: null }] } : presenceOf(id)),
      messages: msgs,
      unread: 0,
      decision,
      lastTs,
    };
  });
}

export interface GuestSession {
  me: GuestId | null;
  status: GuestView | null;
  connected: boolean;
  /** The backlog has loaded — the rooms list is real, not a placeholder. */
  ready: boolean;
  /** Why the last session ended under us (the run restarted / went live /
   *  ended) — shown on the join screen until the guest registers again. */
  notice: string | null;
  threads: Threads;
  register: (name: string, code: string) => Promise<void>;
  join: (faction: string) => Promise<unknown>;
  defect: (to: string) => Promise<unknown>;
  choose: (index: number) => Promise<unknown>;
  escape: () => Promise<unknown>;
  /** Fire one of the story's `who: guest` interactions for yourself. */
  act: (name: string) => Promise<unknown>;
  /** Hybrid chat: type into a channel (a reply carries the root's seq). */
  say: (channel: string, text: string, parentSeq?: number) => Promise<unknown>;
  /** Access control: pull another participant into a membership-gated channel. */
  inviteToChannel: (person: string, channel: string) => Promise<unknown>;
  /** Leave a membership-gated channel. */
  leaveChannel: (channel: string) => Promise<unknown>;
  /** Codex: type (or scan) an unlock code. Resolves to the entry unlocked, if any. */
  redeem: (code: string) => Promise<string | null>;
  /** Codex: hand an entry you hold to another participant or a listed character. */
  shareCodex: (entry: string, to: string) => Promise<unknown>;
  /** Open (creating if needed) a private thread with a guest, or a DM with a character. */
  message: (person: { id: string; kind: "guest" | "character" }) => void;
  /** The alert broadcast that just landed, until dismissed. */
  alert: Alert | null;
  dismissAlert: () => void;
  /** Answer a widget card (a CAPTCHA, a poll) the story showed you. */
  answerWidget: (seq: number, result: WidgetResult) => Promise<void>;
  /** Answers given this session, by card seq (the card renders resolved). */
  widgetAnswers: ReadonlyMap<number, WidgetResult>;
  leave: () => void;
}

export function useGuestSession(): GuestSession {
  const host = usePlayHost();
  const { load, save, drop } = host.storage;
  const crawl = host.crawl;
  const [me, setMe] = useState<GuestId | null>(() => {
    const stored = load<GuestId>(GK);
    // A pre-token session can't authorize any call — drop it so the guest
    // re-registers cleanly rather than staring at 401s.
    if (stored && !stored.token) {
      drop(GK);
      return null;
    }
    if (stored && !stored.eventId) stored.eventId = "default"; // migrate pre-multi-event sessions
    return stored;
  });
  const [status, setStatus] = useState<GuestView | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const base = me ? `/e/${encodeURIComponent(me.eventId)}` : "";
  // EventSource can't set headers, so the capability token rides the URL.
  const url = me ? `${base}/events?role=guest&token=${encodeURIComponent(me.token)}` : null;
  /** The run restarted / went live / ended: this session is dead server-side
   *  (every restart clears guest tokens), so drop it and say why. */
  const dropSession = useCallback((why: string | null) => {
    drop(GK);
    setMe(null);
    setStatus(null);
    setReady(false);
    setNotice(why);
    host.onEnded("guest", why);
  }, [drop, host]);
  // Alerts chime only when they arrive live: the history load sets the
  // baseline so a re-login doesn't replay every alarm of the night.
  const alertMark = useRef(-1);
  const [alert, setAlert] = useState<Alert | null>(null);
  const { typing, onTyping } = useTyping(me !== null ? { role: "guest" } : null);
  const { messages, connected } = useChatStream(url, {
    onSnapshot: (v) => setStatus(v as GuestView),
    onTyping,
    onHistory: (list) => {
      alertMark.current = Math.max(alertMark.current, maxSeqOf(list));
      crawl.loaded(maxSeqOf(list)); // the backlog never crawls; only what lands from now on
      setReady(true);
    },
    onLifecycle: (n) => {
      if (lifecycleDropsSession(n.kind, SessionRole.Guest)) dropSession(lifecycleNotice(n.kind, SessionRole.Guest));
    },
    // The stream closed for good: if the server really no longer knows this
    // token (a restart we slept through), drop the session and say why.
    onDead: () => {
      if (me === null) return;
      void tokenDead(base, "guest", me.token).then((dead) => {
        if (dead) dropSession(lifecycleNotice("reset", SessionRole.Guest));
      });
    },
  });
  useEffect(() => {
    const fresh = pickAlerts(messages.values(), alertMark.current);
    if (fresh.length === 0) return;
    const last = fresh[fresh.length - 1]!;
    alertMark.current = last.seq;
    setAlert({ seq: last.seq, text: last.text });
    if (host.sound) {
      playChime();
      vibrate();
    }
  }, [messages, host.sound]);
  useEffect(() => {
    if (alert === null) return;
    const t = window.setTimeout(() => setAlert(null), 12_000);
    return () => window.clearTimeout(t);
  }, [alert]);

  // Every action is scoped to the event the guest joined (`/e/:eventId/...`)
  // and carries the guest's capability token — the server derives who is
  // acting from the token, never from a client-supplied id. A 401 / "unknown
  // guest" 404 means the run restarted while this phone wasn't listening.
  const post = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      try {
        return await api<T>(`${base}${path}`, body, me?.token);
      } catch (e) {
        // Only explain a session we are dropping right now — never overwrite
        // the notice of one a `lifecycle` frame already dropped.
        if (e instanceof ApiError && guestSessionDead(e.status, e.message) && me !== null) {
          dropSession(lifecycleNotice("reset", SessionRole.Guest));
        }
        throw e;
      }
    },
    [base, me, dropSession],
  );

  const join = useCallback((faction: string) => post("/api/guest/join", { faction }), [post]);
  const defect = useCallback((to: string) => post("/api/guest/defect", { to }), [post]);
  const choose = useCallback((index: number) => post("/api/guest/choose", { index }), [post]);
  const escape = useCallback(() => post("/api/guest/escape", {}), [post]);
  const act = useCallback((name: string) => post("/api/guest/act", { name }), [post]);
  const say = useCallback(
    (channel: string, text: string, parentSeq?: number) => post("/api/guest/say", { channel, text, parentSeq }),
    [post],
  );
  const register = useCallback(async (name: string, code: string) => {
    // Resolve the short event code to its event, then register there.
    const { eventId, title } = await api<ResolvedCode>("/api/resolve-code", { code });
    const r = await api<{ id: string; name: string; token: string }>(
      `/e/${encodeURIComponent(eventId)}/api/guest/register`,
      { name, passcode: code },
    );
    const m: GuestId = { id: r.id, name: r.name, token: r.token, eventId, title };
    crawl.reset();
    save(GK, m);
    setMe(m);
    setNotice(null);
  }, []);
  const leave = useCallback(() => {
    drop(GK);
    setMe(null);
    setStatus(null);
    setReady(false);
    setNotice(null);
    host.onEnded("guest", null);
  }, [drop, host]);

  const inviteToChannel = useCallback(
    (person: string, channel: string) => post("/api/guest/channel/invite", { person, channel }),
    [post],
  );
  const leaveChannel = useCallback((channel: string) => post("/api/guest/channel/leave", { channel }), [post]);

  // --- codex + people ---
  const redeem = useCallback(
    async (code: string): Promise<string | null> => {
      const r = await post<{ unlocked: string | null }>("/api/guest/codex/redeem", { code });
      return r.unlocked;
    },
    [post],
  );
  const shareCodex = useCallback((entry: string, to: string) => post("/api/guest/codex/share", { entry, to }), [post]);
  // A wall QR's link carries `?unlock=<code>`: redeem it once we're signed
  // in and the doors are open, then drop it from the URL so a reload
  // doesn't try again.
  const pendingUnlock = useRef<string | null>(host.ownsPage ? unlockFromSearch(window.location.search) : null);
  useEffect(() => {
    const code = pendingUnlock.current;
    if (code === null || me === null || status === null) return;
    pendingUnlock.current = null;
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${withoutUnlock(window.location.search)}`);
    } catch {
      /* fine */
    }
    void redeem(code).catch(() => {});
  }, [me, status, redeem]);

  // Widgets: one answer per card. The server refuses a second (409); a
  // reload shows the card fresh, and the server's memory settles it.
  const [widgetAnswers, setWidgetAnswers] = useState<ReadonlyMap<number, WidgetResult>>(() => new Map());
  const answerWidget = useCallback(
    async (seq: number, result: WidgetResult) => {
      setWidgetAnswers((prev) => new Map(prev).set(seq, result));
      try {
        await post("/api/guest/widget", { seq, result });
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
    [post],
  );

  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const dock = requiredDecision(status, { choose: (i) => void choose(i), join: (f) => void join(f), escape: () => void escape() });
  const threads = useThreads(withAgents(buildGuestChannels(messages, dock, status, opened, new Set(widgetAnswers.keys())), status, typing));
  const message = useCallback(
    (person: { id: string; kind: "guest" | "character" }) => {
      if (me === null) return;
      const id = person.kind === "character" ? `dm:${person.id}` : pmChannelId(me.id, person.id);
      setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      threads.open(id);
    },
    [me, threads],
  );
  const dismissAlert = useCallback(() => setAlert(null), []);
  useTheme(status?.theme);

  return {
    me,
    status,
    connected,
    ready,
    notice,
    threads,
    register,
    join,
    defect,
    choose,
    escape,
    act,
    say,
    inviteToChannel,
    leaveChannel,
    redeem,
    shareCodex,
    message,
    alert,
    dismissAlert,
    answerWidget,
    widgetAnswers,
    leave,
  };
}

// --- performer (character) --------------------------------------------------

/** Build the performer's surfaces: a scanner, the broadcast feed, one
 *  conversation per guest (targeted messages, for moderation). */
export function buildPrimeChannels(messages: Map<number, ChatMessage>, view: PrimeView | null): Channel[] {
  const all = [...messages.values()];
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
  const feedMsgs = all.filter((m) => m.audience === "all").sort((a, b) => a.seq - b.seq);
  const everyone: Presence[] = (view?.guests ?? []).map((g) => ({ id: g.id, name: g.name, kind: "guest" as const, group: g.faction }));
  const feed: Channel = {
    id: "__feed",
    kind: "lobby",
    title: view?.title ?? "Lobby",
    subtitle: "everyone · broadcast feed",
    spaceId: STORY_SPACE,
    spaceTitle: view?.title,
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
      subtitle: `${g.faction ?? "unaligned"}${where ? ` · 📍 ${where}` : ""}${g.captured ? " · 🔒 captured" : ""}`,
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
  const rooms: Channel[] = (view?.channels ?? []).map((c) => {
    const msgs = all.filter((m) => m.channel === c.id).sort((a, b) => a.seq - b.seq);
    return {
      id: c.id,
      kind: c.kind as Channel["kind"],
      title: c.title,
      spaceId: c.spaceId,
      spaceTitle: c.spaceId === STORY_SPACE ? (view?.title ?? spaceTitles.get(c.spaceId)) : spaceTitles.get(c.spaceId),
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
  const me = view?.character ?? "";
  const cast: Channel[] = (view?.agents ?? []).map((a) => {
    const msgs = all
      .filter((m) => m.channel === `dm:${a.id}` && Array.isArray(m.audience) && m.audience.includes(`@${me}`))
      .sort((x, y) => x.seq - y.seq);
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
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    };
  });
  return [scanner, feed, ...rooms, ...cast, ...guests];
}

/**
 * Guest-side agent chrome: a DM with an agent-voiced character says whether
 * anyone is answering, and shows "… is typing" while a reply is composed.
 */
export function withAgents(channels: Channel[], view: GuestView | null, typing: ReadonlyMap<string, string>): Channel[] {
  const agents = new Map((view?.people ?? []).filter((p) => p.agent !== undefined).map((p) => [`dm:${p.id}`, p.agent!]));
  return channels.map((c) => {
    const agent = agents.get(c.id);
    const who = typing.get(c.id);
    if (agent === undefined && who === undefined) return c;
    return {
      ...c,
      ...(agent !== undefined && c.subtitle === undefined ? { subtitle: agent.online ? "online" : "away — they'll answer when they're back" } : {}),
      ...(who !== undefined ? { typing: who } : {}),
    };
  });
}

export interface PrimeSession {
  auth: PrimeAuth | null;
  view: PrimeView | null;
  responses: Array<{ id: number; text: string }>;
  connected: boolean;
  /** The backlog has loaded — the rooms list is real, not a placeholder. */
  ready: boolean;
  /** Why the last sign-in ended under us (the show went live / the run
   *  ended) — shown on the sign-in screen until the performer signs in again. */
  notice: string | null;
  threads: Threads;
  login: (character: string, passcode: string) => Promise<void>;
  scan: (target: string) => Promise<unknown>;
  /** Hybrid chat: type into a channel as this character (reply via parentSeq). */
  say: (channel: string, text: string, parentSeq?: number) => Promise<unknown>;
  /** Access control: pull a guest into a membership-gated channel. */
  inviteToChannel: (person: string, channel: string) => Promise<unknown>;
  /** Leave a membership-gated channel. */
  leaveChannel: (channel: string) => Promise<unknown>;
  becomeAdmin: (passcode: string) => Promise<void>;
  /** Fire a performer / admin interaction on a guest, as this character. */
  act: (name: string, guest: string) => Promise<unknown>;
  /** Codex: hand one of the character's entries to a guest. */
  shareCodex: (entry: string, to: string) => Promise<unknown>;
  moderate: (id: string, action: string, name?: string) => Promise<unknown>;
  setHidden: (seq: number, hidden: boolean) => Promise<unknown>;
  leave: () => void;
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
  const [responses, setResponses] = useState<Array<{ id: number; text: string }>>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rid = useRef(0);
  const base = auth ? `/e/${encodeURIComponent(auth.eventId)}` : "";
  // The stream's character identity comes from the token server-side; the
  // token rides the URL because EventSource can't set headers.
  const url = auth ? `${base}/events?role=prime&token=${encodeURIComponent(auth.token)}` : null;
  /** The booth's sign-in is gone (the show went live / the run ended). */
  const dropBooth = useCallback((why: string | null) => {
    drop(PK);
    setAuth(null);
    setView(null);
    setResponses([]);
    setReady(false);
    setNotice(why);
    host.onEnded("prime", why);
  }, [drop, host]);
  const { typing, onTyping } = useTyping(auth !== null ? { role: "performer", character: auth.character } : null);
  const { messages, connected } = useChatStream(url, {
    onSnapshot: (v) => setView(v as PrimeView),
    onTyping,
    onHistory: (list) => {
      crawl.loaded(maxSeqOf(list));
      setReady(true);
    },
    onResponse: (text) => setResponses((r) => [{ id: rid.current++, text }, ...r]),
    // Going live signs every performer out (rehearsal booths must not carry
    // into the show); a reset / reload keeps the character — the server just
    // re-sends the snapshot + history.
    onLifecycle: (n) => {
      if (lifecycleDropsSession(n.kind, SessionRole.Performer)) dropBooth(lifecycleNotice(n.kind, SessionRole.Performer));
    },
    // The stream closed for good: confirm the booth's token is really gone
    // (the show went live while the phone slept) before signing out.
    onDead: () => {
      if (auth === null) return;
      void tokenDead(base, "prime", auth.token).then((dead) => {
        if (dead) dropBooth(lifecycleNotice("golive", SessionRole.Performer));
      });
    },
  });

  // Every action is scoped to the event this performer signed into. A 403
  // "sign in" answer means the token lost its character (go-live happened
  // while this phone wasn't listening) — drop the booth and say so.
  const post = useCallback(
    async <T,>(path: string, body?: unknown, token?: string): Promise<T> => {
      try {
        return await api<T>(`${base}${path}`, body, token);
      } catch (e) {
        if (e instanceof ApiError && performerSessionDead(e.status, e.message) && auth !== null) {
          dropBooth(lifecycleNotice("golive", SessionRole.Performer));
        }
        throw e;
      }
    },
    [base, auth, dropBooth],
  );

  const login = useCallback(async (character: string, passcode: string) => {
    // Resolve the performer/mod code to its event, then sign in there.
    const { eventId, title } = await api<ResolvedCode>("/api/resolve-code", { code: passcode });
    const r = await api<{ token: string; character: string; admin: boolean }>(
      `/e/${encodeURIComponent(eventId)}/api/prime/login`,
      { character, passcode },
    );
    const a: PrimeAuth = { token: r.token, character: r.character, admin: !!r.admin, eventId, title };
    crawl.reset();
    save(PK, a);
    setAuth(a);
    setNotice(null);
  }, []);
  const scan = useCallback((target: string) => post("/api/scan", { target }, auth!.token), [post, auth]);
  const say = useCallback(
    (channel: string, text: string, parentSeq?: number) =>
      post("/api/prime/say", { channel, text, parentSeq }, auth!.token),
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
    (name: string, guest: string) => post("/api/prime/act", { name, guest }, auth!.token),
    [post, auth],
  );
  const shareCodex = useCallback(
    (entry: string, to: string) => post("/api/prime/codex/share", { entry, to }, auth!.token),
    [post, auth],
  );
  const moderate = useCallback(
    (id: string, action: string, name?: string) => post("/api/mod/act", { id, action, name }, auth!.token),
    [post, auth],
  );
  const setHidden = useCallback(
    (seq: number, hidden: boolean) => post("/api/mod/message", { seq, hidden }, auth!.token),
    [post, auth],
  );
  const leave = useCallback(() => {
    drop(PK);
    setAuth(null);
    setView(null);
    setResponses([]);
    setReady(false);
    setNotice(null);
    host.onEnded("prime", null);
  }, [drop, host]);

  const threads = useThreads(buildPrimeChannels(messages, view).map((c) => (typing.has(c.id) ? { ...c, typing: typing.get(c.id) } : c)));
  useTheme(view?.theme);
  return { auth, view, responses, connected, ready, notice, threads, login, scan, say, inviteToChannel, leaveChannel, becomeAdmin, act, shareCodex, moderate, setHidden, leave };
}
