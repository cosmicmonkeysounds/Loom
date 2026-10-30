//! The booth's pop-out driver (wave 18, BOOTH-SPEC §4): on every snapshot it
//! diffs the view (and the door readouts) against what this phone has
//! already seen, and raises / retires pop-outs on the rung — the Wanted
//! pop-out (and bursts), the door, the NOW objective's target, the picker
//! that just became live, a caller's *Call it?*. "First seen" memory persists
//! per sign-in (`loom.booth.seen.<token>`), so a reload never re-pops a mark
//! someone else already claimed.
//!
//! Wave 48 (C5): the censor's 🔑 LANGUAGE (`DriverOpts.filter`): one at a
//! time, only while no filter pop-out is up or held and the filter window
//! is closed; lines that arrive meanwhile only count (`filter/model.ts`
//! `filterPlan`, memory `loom.booth.filter.<token>`).

import { useEffect, useMemo, useRef } from "react";
import { usePlayHost } from "../../host.ts";
import type { PrimeSession } from "../../session/prime.ts";
import type { Interaction } from "../../types.ts";
import { boothView, callsOf, mayPress, wantedOf, type BoothGuest, type BoothMessage, type BoothObjective } from "../wire.ts";
import { countdownRunning, cueAtEnd, cueSpecs, cueWaitsFor, doorQueue, doorSpec, pickLayout, pickReadySpec, reconcilePopOuts, rememberCountdowns, targetSpec, wantedSpecs, type BoothDo, type CountdownMemo, type Draft, type SeenMap } from "./model.ts";
import { playTone, usePopOuts, type PopOutSpec } from "./rung.ts";
import { newMissionSpec } from "../mission-model.ts";
import { filterDraft, filterPlan, filterPopSeq } from "../filter/model.ts";
import type { FilterApi } from "../filter/use-filter.ts";

/** What a bound pop-out's buttons may open in the booth. */
export interface BoothOpeners {
  act: (name: string, guest?: string) => Promise<unknown>;
  card: (guest: string, confront?: "rescan") => void;
  scan: (guest?: string, name?: string) => void;
  board: () => void;
  door: () => void;
  pick: (objective: string) => void;
  cue: (id: string) => void;
  /** Wave 21 (P5): open the player's Mission window. */
  mission?: () => void;
  /** A claim was pressed on this guest (the race line). */
  tried?: (guest: string) => void;
  /** Wave 48 (C5): ✂ a flagged line; rejects on a refusal (the pop-out stays, saying why). */
  censor?: (seq: number) => Promise<unknown>;
  /** Wave 48 (C5): Let it go (this phone only). */
  letGo?: (seq: number) => void;
  /** Wave 48 (C5): open the filter window. */
  filter?: () => void;
}

/** Bind a draft's buttons to the booth. */
export function bindDraft(d: Draft, open: BoothOpeners, defer: (key: string) => void): PopOutSpec {
  const run = (x: BoothDo): (() => void | Promise<unknown>) => {
    switch (x.kind) {
      case "act":
        return () => {
          if (x.name === "claim_escort" && x.guest !== undefined) open.tried?.(x.guest);
          return open.act(x.name, x.guest);
        };
      case "card":
        return () => open.card(x.guest, x.confront);
      case "scan":
        return () => open.scan(x.guest, x.name);
      case "board":
        return () => open.board();
      case "door":
        return () => open.door();
      case "claimDoor":
        return () =>
          open.act("claim_door", x.guest).then(
            () => open.scan(x.guest, x.name),
            () => open.scan(x.guest, x.name),
          );
      case "pick":
        return () => open.pick(x.objective);
      case "cue":
        return () => open.cue(x.id);
      case "mission":
        return () => open.mission?.();
      case "censor":
        return () => open.censor?.(x.seq);
      case "letGo":
        return () => open.letGo?.(x.seq);
      case "filter":
        return () => open.filter?.();
      case "later":
        return () => defer(d.key);
      case "ok":
        return () => {};
    }
  };
  return { ...d, actions: d.actions.map((a) => ({ ...a, run: run(a.do) })) };
}

const SEEN_KEY = (token: string) => `loom.booth.seen.${token}`;
/** Wave 21 (P5): the objectives this sign-in has had as its NOW. */
const MISSIONS_KEY = (token: string) => `loom.booth.missions.${token}`;

/** *Call it?* put off with "Not yet" comes back after this long (§4.9). */
export const REMIND_MS = 2 * 60_000;

export interface DriverOpts {
  session: PrimeSession;
  open: BoothOpeners;
  /** Story ms now (the view's clock plus the time since it arrived). */
  now: number;
  placeTitle: (loc: string | null) => string | null;
  /** When this booth's own cue last fired (PLAYER SELECT opens at once after it). */
  ownFireAt: () => number | null;
  /** The target pop-out's current key (the NOW row taps it back). */
  targetKey?: { current: string | null };
  /** Wave 37 (C7): is this objective's Mission card on screen now? Then a
   *  NEW MISSION for it pops nothing: the driver chimes once and calls
   *  `onMissionNews` (the booth blinks its title bar). Default: never. */
  missionShown?: (objectiveId: string) => boolean;
  /** Wave 37 (C7): a NEW MISSION said by the title bar, not a pop-out. */
  onMissionNews?: (o: { id: string; title: string }) => void;
  /** Wave 48 (C5): the censor's filter (`filter/use-filter.ts`); absent: no 🔑 pop-outs. */
  filter?: FilterApi;
  /** Wave 48 (C5): the filter window is open (it owns every flagged line then). */
  filterOpen?: boolean;
}

export function useBoothPopOuts({ session, open, now, placeTitle, ownFireAt, targetKey, missionShown, onMissionNews, filter, filterOpen = false }: DriverOpts): void {
  const host = usePlayHost();
  const rung = usePopOuts();
  const token = session.auth?.token ?? "";
  const view = boothView(session.view);
  const me = session.auth?.character ?? "";
  const seen = useRef<SeenMap | null>(null);
  if (seen.current === null) {
    try {
      seen.current = host.storage.load<SeenMap>(SEEN_KEY(token)) ?? {};
    } catch {
      seen.current = {};
    }
  }
  const tried = useRef(new Set<string>());
  const openRef = useRef(open);
  openRef.current = open;
  const opener: BoothOpeners = useMemo(
    () => ({
      act: (n, g) => openRef.current.act(n, g),
      card: (g, c) => openRef.current.card(g, c),
      scan: (g, n) => openRef.current.scan(g, n),
      board: () => openRef.current.board(),
      door: () => openRef.current.door(),
      pick: (o) => openRef.current.pick(o),
      cue: (id) => openRef.current.cue(id),
      mission: () => openRef.current.mission?.(),
      tried: (g) => tried.current.add(g),
      censor: (seq) => openRef.current.censor?.(seq) ?? Promise.resolve(),
      letGo: (seq) => openRef.current.letGo?.(seq),
      filter: () => openRef.current.filter?.(),
    }),
    [],
  );
  // "Not yet" on *Call it?*: the pop-out comes back after 2 min while the cue stays live.
  const laterAt = useRef(new Map<string, { at: number; n: number }>());
  const later = (key: string) => {
    laterAt.current.set(key, { at: Date.now(), n: (laterAt.current.get(key)?.n ?? 0) + 1 });
    rung.defer(key);
  };
  const bind = (d: Draft) => bindDraft(d, opener, later);
  const interactions: readonly Interaction[] = view?.interactions ?? [];
  const guests: readonly BoothGuest[] = view?.guests ?? [];
  const guestOf = (id: string) => guests.find((g) => g.id === id) ?? null;

  // The Wanted pop-outs: every snapshot.
  const wanted = wantedOf(view);
  const wantedKey = JSON.stringify(wanted ?? null);
  // Only a booth that may claim (an Antivirus) gets Wanted pop-outs; a host reads the board (§12.6).
  const claimer = mayPress(interactions, "claim_escort", me);
  useEffect(() => {
    if (wanted === null || !claimer) return;
    const r = wantedSpecs(wanted, seen.current ?? {}, { me, now, placeTitle, guestOf, tried: tried.current, canRelease: mayPress(interactions, "release_escort", me) });
    seen.current = r.seen;
    try {
      host.storage.save(SEEN_KEY(token), r.seen);
    } catch {
      /* kept in memory */
    }
    for (const d of r.raise) rung.raise(bind(d));
    for (const k of r.retire) rung.retire(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, me, claimer]);

  // The door: the `!!🚪` readouts, re-judged every few seconds (the 60 s rule).
  const queue = doorQueue(session.messages.values() as Iterable<BoothMessage>, guests);
  const step = view?.night?.step ?? null;
  const canClaimDoor = mayPress(interactions, "claim_door", me);
  const doorBucket = Math.floor(now / 5000);
  const queueKey = JSON.stringify(queue.map((e) => [e.id, e.claimedBy]));
  useEffect(() => {
    const d = doorSpec(queue, step, now, canClaimDoor);
    if (d !== null) rung.raise(bind(d));
    else if (queue.every((e) => e.claimedBy !== null)) rung.retire("door");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey, step, doorBucket, canClaimDoor]);

  // The NOW objective: its target (the bottle), or its picker going live.
  const nowObj = (view?.objectives ?? [])[0] as BoothObjective | undefined;
  const firstLive = useRef(new Map<string, number>());
  const lastTarget = useRef<string | null>(null);
  const objKey = nowObj === undefined ? "" : `${nowObj.id}|${nowObj.target?.id ?? ""}`;
  useEffect(() => {
    if (nowObj === undefined) {
      if (lastTarget.current !== null) rung.retire(lastTarget.current);
      lastTarget.current = null;
      return;
    }
    if (!firstLive.current.has(nowObj.id)) firstLive.current.set(nowObj.id, now);
    const layout = pickLayout(nowObj, interactions);
    if (layout === "target" && nowObj.target !== undefined) {
      const seenAt = firstLive.current.get(`${nowObj.id}:${nowObj.target.id}`) ?? now;
      firstLive.current.set(`${nowObj.id}:${nowObj.target.id}`, seenAt);
      const key = `target:${nowObj.id}:${nowObj.target.id}:${seenAt}`;
      if (lastTarget.current !== null && lastTarget.current !== key) rung.retire(lastTarget.current);
      lastTarget.current = key;
      if (targetKey !== undefined) targetKey.current = key;
      const target = nowObj.target;
      const raise = (live: readonly string[] | null) => {
        const d = targetSpec(nowObj, live, interactions, placeTitle, seenAt);
        if (d !== null) rung.raise(bind(d));
      };
      session.card(target.id).then(
        (c) => raise(c.live),
        () => raise(null),
      );
      return;
    }
    if (lastTarget.current !== null) rung.retire(lastTarget.current);
    lastTarget.current = null;
    if (layout === "steps" || layout === "rows") {
      const r = pickReadySpec(nowObj, layout, ownFireAt(), Date.now(), firstLive.current.get(nowObj.id) ?? now);
      if (r === "open") opener.pick(nowObj.id);
      else if (r !== null) rung.raise(bind(r));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objKey]);

  // Wave 21 (P5): a player's NEW MISSION pop-out — never a host's.
  const player = view?.player === true && view.host !== true;
  const missions = useRef<string[] | null | undefined>(undefined);
  if (missions.current === undefined) {
    try {
      missions.current = host.storage.load<string[]>(MISSIONS_KEY(token)) ?? null;
    } catch {
      missions.current = null;
    }
  }
  const headId = nowObj?.id ?? "";
  useEffect(() => {
    if (!player) return;
    const r = newMissionSpec(view?.objectives ?? [], missions.current ?? null, now);
    missions.current = r.seen;
    try {
      host.storage.save(MISSIONS_KEY(token), r.seen);
    } catch {
      /* kept in memory */
    }
    if (r.draft === null) return;
    const id = r.draft.key.slice("mission:".length);
    if (missionShown?.(id) === true) {
      // Wave 37 (C7): said once — the Mission card is the instruction. Face
      // to face (PLAYER SELECT is a quiet scope) it says it without a tone.
      if (!rung.quietNow()) playTone("info", host.sound && r.draft.sound !== false);
      onMissionNews?.({ id, title: r.draft.title });
    } else rung.raise(bind(r.draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headId, player]);
  // Wave 37 (C7, fix round): one that popped while Mission was off screen
  // (raised under a card or the scanner, held quiet) is moot once Mission is
  // on screen (× landed there): the title bar blinks instead. It chimes then
  // only if it never reached the screen.
  // Wave 47: so is a held YOUR GAME IS ON (its ▣ Go to Mission is done).
  const moot = player ? rung.held.find((e) => e.deferredAt === undefined && ((e.spec.key.startsWith("mission:") && missionShown?.(e.spec.key.slice("mission:".length)) === true) || (e.spec.key.startsWith("game:") && headId !== "" && missionShown?.(headId) === true))) : undefined;
  const mootKey = moot?.spec.key ?? null;
  const onScreenMission = (rung.current?.key.startsWith("mission:") === true || rung.current?.key.startsWith("game:") === true) && !rung.quieted ? rung.current.key : null;
  const missionsSeen = useRef(new Set<string>());
  if (onScreenMission !== null && onScreenMission !== mootKey) missionsSeen.current.add(onScreenMission);
  useEffect(() => {
    if (moot === undefined || mootKey === null) return;
    rung.retire(mootKey);
    if (!missionsSeen.current.has(mootKey) && !rung.quietNow()) playTone("info", host.sound && moot.spec.sound !== false);
    const game = mootKey.startsWith("game:");
    onMissionNews?.({ id: game ? headId : mootKey.slice("mission:".length), title: game ? (nowObj?.title ?? moot.spec.title) : moot.spec.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mootKey]);

  // Wave 48 (C5): the censor's 🔑 LANGUAGE. A new line pops once, one at a
  // time; while one is up or held (on screen, queued, quiet, in 🔔 Waiting)
  // or the window is open, new lines only count. A held one whose line left
  // the list (censored, let go, hidden) retires; one still waiting is raised
  // again in place (its 🔑 All flagged count, a refusal, buttons after a reload).
  const heldFilter = rung.held.filter((e) => filterPopSeq(e.spec.key) !== null);
  const heldFilterKey = heldFilter.map((e) => `${e.spec.key}:${e.restored === true ? 1 : 0}`).join("|");
  const filterKey = filter === undefined || session.view === null ? null : filter.key;
  useEffect(() => {
    if (filter === undefined || filterKey === null) return;
    const plan = filterPlan(filter.waiting, filter.seen, heldFilter.map((e) => e.spec.key), { windowOpen: filterOpen });
    if (plan.seen.length > 0) filter.markSeen(plan.seen);
    for (const k of plan.retire) rung.retire(k);
    const n = filter.waiting.length;
    for (const line of plan.refresh) rung.raise(bind(filterDraft(line, n, filter.refusal(line.seq))));
    if (plan.raise !== null) rung.raise(bind(filterDraft(plan.raise, n, filter.refusal(plan.raise.seq))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, heldFilterKey, filterOpen]);

  // A caller: *Call it?* when one of its cues turns live after the first look.
  const calls = callsOf(view);
  const prevLive = useRef<Set<string> | null>(null);
  const prevPresses = useRef<number | null>(null);
  const callsKey = calls === null ? "" : JSON.stringify([calls.presses, calls.rows.map((r) => [r.id, r.live])]);
  // When each countdown first showed (story ms): a cue that turned live
  // with one waits for it to end (BN-F3).
  const cdSeen = useRef(new Map<string, number>());
  for (const c of view?.countdowns ?? []) if (!cdSeen.current.has(c.label)) cdSeen.current.set(c.label, now);
  // Every countdown seen lately, ended ones too (the view drops them at the end).
  const cdMemo = useRef(new Map<string, CountdownMemo>());
  const seenCountdowns = rememberCountdowns(cdMemo.current, view?.countdowns, now);
  const cueWait = useRef(new Map<string, string>());
  const endRaised = useRef(new Set<string>());
  useEffect(() => {
    if (calls === null) return;
    for (const d of cueSpecs(calls, prevLive.current, now, view?.countdowns)) {
      const waits = cueWaitsFor(view?.countdowns, cdSeen.current, now);
      if (waits !== null) cueWait.current.set(d.key, waits);
      else rung.raise(bind(d));
    }
    // Moot: a cue that fired (presses moved) or stopped being live.
    if (prevPresses.current !== null && prevPresses.current !== calls.presses) for (const r of calls.rows) rung.retire(`cue:${r.id}:${prevPresses.current}`);
    prevPresses.current = calls.presses;
    for (const r of calls.rows) if (!r.live) rung.retire(`cue:${r.id}:${calls.presses}`);
    prevLive.current = new Set(calls.rows.filter((r) => r.live).map((r) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsKey]);
  // What the store holds vs the night: moot ones go (a list whose objective
  // ended, a confrontation about someone caught, a burst whose programs
  // were all caught), and the ones restored from storage without their
  // buttons get them back (BN-F4, NM-F7, NM-F8, NM-F13).
  const heldKey = rung.held.map((e) => `${e.spec.key}:${e.restored === true ? 1 : 0}:${(e.spec.rows ?? []).length}`).join("|");
  const objIds = JSON.stringify((view?.objectives ?? []).map((o) => [o.id, (o as BoothObjective).target?.id ?? null]));
  const caughtKey = guests.filter((g) => g.captured).map((g) => g.id).join(",");
  // When the headline last changed while this booth watched (a game's cue is
  // over then), and a slow clock so a held game retires at its minute.
  const headline = useRef<{ id: string; at: number | null } | null>(null);
  if (headline.current === null) headline.current = { id: headId, at: null };
  else if (headline.current.id !== headId) headline.current = { id: headId, at: now };
  const gameBucket = rung.held.some((e) => e.spec.key.startsWith("game:")) ? Math.floor(now / 5_000) : 0;
  useEffect(() => {
    if (rung.held.length === 0) return;
    const r = reconcilePopOuts(rung.held, {
      headlineAt: headline.current?.at ?? null,
      wanted,
      objectives: (view?.objectives ?? []) as BoothObjective[],
      calls,
      guestOf,
      wctx: { me, now, placeTitle, guestOf, tried: tried.current, canRelease: mayPress(interactions, "release_escort", me) },
    });
    for (const k of r.retire) rung.retire(k);
    for (const d of r.rebind) rung.raise(bind(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldKey, wantedKey, objIds, callsKey, caughtKey, gameBucket]);

  // A deferred *Call it?* pops once its countdown is up; and when a
  // countdown ends with the caller's own cue as the sheet's NEXT, it pops too.
  const cueBucket = Math.floor(now / 5_000);
  useEffect(() => {
    if (calls === null) return;
    for (const [key, label] of [...cueWait.current]) {
      if (countdownRunning(view?.countdowns, label, now)) continue;
      cueWait.current.delete(key);
      const d = cueSpecs(calls, new Set(), now, view?.countdowns).find((x) => x.key === key);
      if (d !== undefined) rung.raise(bind(d));
    }
    const end = cueAtEnd(calls, seenCountdowns, now);
    if (end !== null && !endRaised.current.has(`${end.key}|${end.rev}`)) {
      endRaised.current.add(`${end.key}|${end.rev}`);
      rung.raise(bind(end));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cueBucket, callsKey]);

  const laterBucket = Math.floor(now / 30_000);
  useEffect(() => {
    if (calls === null) return;
    for (const [key, l] of laterAt.current) {
      if (Date.now() - l.at < REMIND_MS) continue;
      const d = cueSpecs(calls, new Set(), now, view?.countdowns).find((x) => x.key === key);
      if (d === undefined) {
        laterAt.current.delete(key);
        continue;
      }
      laterAt.current.set(key, { at: Date.now(), n: l.n });
      rung.raise(bind({ ...d, rev: `again:${l.n}` }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laterBucket, callsKey]);
}
