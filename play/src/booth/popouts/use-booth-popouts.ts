//! The booth's pop-out driver (wave 18, BOOTH-SPEC §4): on every snapshot it
//! diffs the view (and the door readouts) against what this phone has
//! already seen, and raises / retires pop-outs on the rung — the Wanted
//! pop-out (and bursts), the door, the NOW objective's target, the picker
//! that just became live, Clippy's *Call it?*. "First seen" memory persists
//! per sign-in (`loom.booth.seen.<token>`), so a reload never re-pops a mark
//! someone else already claimed.

import { useEffect, useMemo, useRef } from "react";
import { usePlayHost } from "../../host.ts";
import type { PrimeSession } from "../../session/prime.ts";
import type { Interaction } from "../../types.ts";
import { boothView, callsOf, mayPress, wantedOf, type BoothGuest, type BoothMessage, type BoothObjective } from "../wire.ts";
import { cueSpecs, doorQueue, doorSpec, pickLayout, pickReadySpec, targetSpec, wantedSpecs, type BoothDo, type Draft, type SeenMap } from "./model.ts";
import { usePopOuts, type PopOutSpec } from "./rung.ts";

/** What a bound pop-out's buttons may open in the booth. */
export interface BoothOpeners {
  act: (name: string, guest?: string) => Promise<unknown>;
  card: (guest: string, confront?: "rescan") => void;
  scan: (guest?: string, name?: string) => void;
  board: () => void;
  door: () => void;
  pick: (objective: string) => void;
  cue: (id: string) => void;
  /** A claim was pressed on this guest (the race line). */
  tried?: (guest: string) => void;
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
      case "later":
        return () => defer(d.key);
      case "ok":
        return () => {};
    }
  };
  return { ...d, actions: d.actions.map((a) => ({ ...a, run: run(a.do) })) };
}

const SEEN_KEY = (token: string) => `loom.booth.seen.${token}`;

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
}

export function useBoothPopOuts({ session, open, now, placeTitle, ownFireAt, targetKey }: DriverOpts): void {
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
      tried: (g) => tried.current.add(g),
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

  // Clippy: *Call it?* when one of its cues turns live after the first look.
  const calls = callsOf(view);
  const prevLive = useRef<Set<string> | null>(null);
  const prevPresses = useRef<number | null>(null);
  const callsKey = calls === null ? "" : JSON.stringify([calls.presses, calls.rows.map((r) => [r.id, r.live])]);
  useEffect(() => {
    if (calls === null) return;
    for (const d of cueSpecs(calls, prevLive.current, now, view?.countdowns)) rung.raise(bind(d));
    // Moot: a cue that fired (presses moved) or stopped being live.
    if (prevPresses.current !== null && prevPresses.current !== calls.presses) for (const r of calls.rows) rung.retire(`cue:${r.id}:${prevPresses.current}`);
    prevPresses.current = calls.presses;
    for (const r of calls.rows) if (!r.live) rung.retire(`cue:${r.id}:${calls.presses}`);
    prevLive.current = new Set(calls.rows.filter((r) => r.live).map((r) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsKey]);
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
