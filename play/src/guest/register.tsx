//! The guest's sign-in: the code, the program picker + directory search,
//! the picture pick, and switching pictures later (moved out of
//! `guest.tsx` in wave 13).

import { useMemo, useState, type ComponentProps } from "react";
import type { GetBackIn as GetBackInPanel } from "./get-back-in.tsx";
import { PersonAvatar } from "../ui/primitives.tsx";
import { usePlayHost } from "../host.ts";
import { avatarUrl, hitNote, hitPickable, initialPick, orderPicker, rowNote, rowPickable, rowTitle, type IdentityRow, type PictureChoice, type PictureChoices, type ProgramHit } from "../avatars.ts";
import { claimFromSearch, joinClaim, registerErrorText } from "../claim.ts";
import { PictureGrid } from "../picture-pick.tsx";
import { codeFromUrl, fetchPictures, searchPrograms, useIdentities, useLandingBrand } from "../session/shared.ts";
import type { GuestSession } from "../session/guest.ts";
import { printedBadge, storedBadge } from "../rejoin.ts";
import { lazyPart } from "./lazy-part.tsx";

/**
 * The picker's two parts (wave 13): the programs anyone may be (free first,
 * then the taken ones, greyed), and the featured programs reserved for
 * their invited guests, which fold away behind "Reserved for invited
 * guests (n)" — an invitation's `?claim=` makes its program an ordinary
 * free tile, so the invitee never opens the fold.
 */
export function pickerSections(rows: readonly IdentityRow[]): { open: IdentityRow[]; reserved: IdentityRow[] } {
  const ordered = orderPicker(rows);
  const locked = (r: IdentityRow) => !r.claimed && r.reserved === true;
  return { open: ordered.filter((r) => !locked(r)), reserved: ordered.filter(locked) };
}

/** The fold's label. */
export function reservedFoldLabel(n: number): string {
  return `🔒 Reserved for invited guests (${n})`;
}

/** Wave 23's "Already playing? Get back in" (its own chunk). */
const GetBackIn = lazyPart<ComponentProps<typeof GetBackInPanel>>(() => import("./get-back-in.tsx").then((m) => ({ default: m.GetBackIn })), "Get back in");

export function GuestRegister({ session }: { session: GuestSession }) {
  const host = usePlayHost();
  const [code, setCode] = useState(codeFromUrl);
  // An invitation's `?claim=` opens its reserved program to this guest: kept
  // for the whole join (the picker and the register both carry it).
  // An invitee whose session was cut (a restart, End → relaunch, Leave)
  // rejoins with the claim this browser kept for the code.
  const [urlClaim] = useState(() => (host.ownsPage ? claimFromSearch(window.location.search) : null));
  const claim = joinClaim(urlClaim, host.storage, code);
  // Wave 23: a blank badge scanned on the way in (kept beside the code);
  // `badgeSeen` re-reads it once the Get-back-in panel stores one.
  const [badgeSeen, setBadgeSeen] = useState(0);
  const badge = useMemo(() => storedBadge(host.storage, code), [host, code, badgeSeen]);
  // The Get-back-in panel is open: the new-guest picker steps aside.
  const [rejoining, setRejoining] = useState(false);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProgramHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const eventTitle = useLandingBrand().title;
  // The code opens the picker: the story's unclaimed programs, with their
  // pictures, and (when the server has the program directory) a search.
  // Scanned before the director opened the doors: there is nobody to be
  // yet. Say so, and ask again until there is.
  const { ids, busy: serverBusy, refresh } = useIdentities(code, (r) => r.doorsOpen === false, claim);
  const resolved = ids !== null && ids !== "loading" && ids.kind === "ok" ? ids : null;
  const closed = resolved !== null && resolved.doorsOpen === false;
  const fallback = ids !== null && ids !== "loading" && ids.kind === "unavailable" ? ids : null;
  const programs = resolved === null ? [] : orderPicker(resolved.identities);
  // Wave 54: a printed badge fills everything in. Its event code is good, so
  // the box steps aside, and an invited one lands on its own program.
  const filledIn = resolved !== null && (badge !== null || claim !== null);
  const invited = programs.find((r) => r.name === resolved?.invited && !r.claimed) ?? null;
  const sections = pickerSections(programs);
  const [reservedOpen, setReservedOpen] = useState(false);
  // Having picked a program, the guest picks its picture (when there is
  // more than one to choose from).
  const [picking, setPicking] = useState<{ name: string; wiki?: string; options: PictureChoice[]; selected: string | null } | null>(null);
  const go = async (name: string, wiki?: string, picture?: string) => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await session.register(name, code.trim(), wiki, picture, claim);
    } catch (e) {
      setErr(registerErrorText(e));
      setPicking(null);
      refresh(); // someone may have just taken it — refresh the list
      if (hits !== null) setHits(null);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (name: string, wiki?: string) => {
    if (busy || resolved === null) return;
    setBusy(true);
    setErr("");
    let options: PictureChoice[] = [];
    let as = name;
    try {
      const r = await fetchPictures(resolved.eventId, code.trim(), wiki !== undefined ? { wiki } : { name }, claim);
      options = r.options;
      as = r.name;
    } catch {
      // no options to show (an older server, the directory offline): just join
    } finally {
      setBusy(false);
    }
    if (options.length <= 1) return void go(name, wiki, options[0]?.key);
    setPicking({ name: as, ...(wiki !== undefined ? { wiki } : {}), options, selected: initialPick(options) });
  };
  const search = async () => {
    if (resolved === null || searching) return;
    const query = q.trim();
    if (query === "") return;
    setSearching(true);
    setErr("");
    try {
      setHits(await searchPrograms(resolved.eventId, code.trim(), query, claim));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const picture = (key: string | null) => (resolved !== null && key !== null ? avatarUrl(resolved.eventId, key) : null);
  return (
    <div className="hero">
      <div className="glyph">🎟️</div>
      <h1>{resolved?.title ?? fallback?.title ?? eventTitle ?? "Loom"}</h1>
      {session.notice && <p className="notice">{session.notice}</p>}
      {!filledIn && <p className="sub">Enter the code from your host, then pick the program you are tonight.</p>}
      {claim !== null && invited === null && <p className="pick-hint">Your invitation saved your program for you — pick it below.</p>}
      {badge !== null && invited === null && <p className="pick-hint">🪪 Badge {printedBadge(badge)} links to the program you pick. Lose this page? Scan your badge to get back in.</p>}
      {!filledIn && (
        <input
          placeholder="Event code, or your badge's code"
          value={code}
          autoFocus={code === ""}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
        />
      )}
      {picking === null && invited === null && <GetBackIn code={code} open={rejoining} onOpen={setRejoining} onIn={session.adopt} onBlankBadge={() => setBadgeSeen((n) => n + 1)} />}
      {ids === "loading" && <p className="pick-hint">Looking up the program list…</p>}
      {ids !== null && ids !== "loading" && ids.kind === "unknown" && <p className="pick-hint">That code doesn't open anything. Check it with your host.</p>}
      {fallback !== null && (
        <>
          <p className="pick-hint">The code is good, but the server couldn't send the program list — {fallback.error}. It may need a restart. You can still join by name:</p>
          <input placeholder="What do they call you?" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go(name.trim() || "Guest")} />
          <button className="choice primary" onClick={() => void go(name.trim() || "Guest")} disabled={busy}>
            {busy ? "Joining…" : "Join →"}
          </button>
        </>
      )}
      {serverBusy && (
        <p className="pick-hint" role="status">
          The server is busy — trying again in a moment.
        </p>
      )}
      {closed && (
        <p className="pick-hint" role="status">
          The doors aren't open yet — hang on, this page refreshes by itself.
        </p>
      )}
      {resolved !== null && !closed && picking !== null && (
        <div className="cast-pick" role="group" aria-label={`Your picture as ${picking.name}`}>
          <div className="sheet-h">Your picture as {picking.name}</div>
          <p className="pick-hint">Pick the one that looks most like you.</p>
          <PictureGrid eventId={resolved.eventId} options={picking.options} selected={picking.selected} onSelect={(key) => setPicking({ ...picking, selected: key })} disabled={busy} />
          <button className="choice primary" disabled={busy} onClick={() => void go(picking.name, picking.wiki, picking.selected ?? undefined)}>
            {busy ? "Uploading…" : `Be ${picking.name} →`}
          </button>
          <button className="choice ghost" disabled={busy} onClick={() => setPicking(null)}>
            ← Pick another program
          </button>
        </div>
      )}
      {invited !== null && !closed && (
        <div className="cast-pick" role="group" aria-label={`You are ${invited.name}`}>
          <PersonAvatar name={invited.name} size="lg" src={picture(invited.avatar)} />
          <div className="sheet-h">You are {invited.name}</div>
          <p className="pick-hint">Your invitation saved this program for you.</p>
          <button className="choice primary" disabled={busy} onClick={() => void go(invited.name)}>
            {busy ? "Uploading…" : "Start your upload →"}
          </button>
        </div>
      )}
      {resolved !== null && !closed && picking === null && !rejoining && invited === null && (
        <div className="cast-pick" role="group" aria-label="Which program are you?">
          <div className="sheet-h">Which program are you?</div>
          {programs.length === 0 && <p className="pick-hint">{resolved.search ? "Every named program is taken — search for another below." : "No programs left to pick — ask your host."}</p>}
          <div className="pick-grid">
            {sections.open.map((r) => (
              <button
                key={r.name}
                type="button"
                className={`choice pick ghost ${rowPickable(r) ? "" : "claimed"} ${!r.claimed && r.reserved === true ? "reserved" : ""}`}
                disabled={busy || !rowPickable(r)}
                title={rowTitle(r)}
                onClick={() => void pick(r.name)}
              >
                <PersonAvatar name={r.name} size="lg" src={picture(r.avatar)} />
                <span className="pick-label">
                  {r.name}
                  {rowNote(r) !== null && <span className="pick-sub"> · {rowNote(r)}</span>}
                </span>
              </button>
            ))}
          </div>
          {sections.reserved.length > 0 && (
            <>
              <button type="button" className="choice ghost pick-fold" aria-expanded={reservedOpen} onClick={() => setReservedOpen((v) => !v)}>
                <span aria-hidden>{reservedOpen ? "▾" : "▸"}</span> {reservedFoldLabel(sections.reserved.length)}
              </button>
              {reservedOpen && (
                <div className="pick-grid">
                  {sections.reserved.map((r) => (
                    <button
                      key={r.name}
                      type="button"
                      className={`choice pick ghost ${rowPickable(r) ? "" : "claimed"} ${!r.claimed && r.reserved === true ? "reserved" : ""}`}
                      disabled={busy || !rowPickable(r)}
                      title={rowTitle(r)}
                      onClick={() => void pick(r.name)}
                    >
                      <PersonAvatar name={r.name} size="lg" src={picture(r.avatar)} />
                      <span className="pick-label">
                        {r.name}
                        {rowNote(r) !== null && <span className="pick-sub"> · {rowNote(r)}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {resolved.search && (
            <>
              <div className="sheet-h">Something else?</div>
              <div className="pick-search">
                <input
                  placeholder="Any software — e.g. NHL 97, Winamp…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void search()}
                  aria-label="Search the program directory"
                />
                <button type="button" className="choice ghost" onClick={() => void search()} disabled={searching || q.trim() === ""}>
                  {searching ? "…" : "Search"}
                </button>
              </div>
              {hits !== null && hits.length === 0 && <p className="pick-hint">Nothing in the directory by that name. Try another spelling.</p>}
              {hits !== null && hits.length > 0 && (
                <div className="pick-results" role="list">
                  {hits.map((h) => (
                    <button
                      key={h.name}
                      type="button"
                      role="listitem"
                      className={`choice pick ghost ${hitPickable(h) ? "" : "claimed"} ${!h.claimed && h.reserved === true ? "reserved" : ""}`}
                      disabled={busy || !hitPickable(h)}
                      onClick={() => void pick(h.name, h.name)}
                    >
                      <PersonAvatar name={h.name} size="lg" src={picture(h.avatar)} />
                      <span className="pick-label">
                        {h.name}
                        <span className="pick-desc">{hitNote(h)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {busy && <p className="pick-hint">Uploading…</p>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

/** Switch your profile picture to another of your program's — opened on
 *  demand, so the pass sheet never waits on the directory. */
export function PictureChanger({ session, eventId }: { session: GuestSession; eventId: string }) {
  const [state, setState] = useState<PictureChoices | "closed" | "loading">("closed");
  const [err, setErr] = useState("");
  const open = async () => {
    setState("loading");
    setErr("");
    try {
      setState(await session.pictures());
    } catch (e) {
      setErr((e as Error).message);
      setState("closed");
    }
  };
  const choose = async (key: string) => {
    if (state === "closed" || state === "loading" || key === state.avatar) return;
    setErr("");
    try {
      setState(await session.setPicture(key));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  if (state === "closed" || state === "loading") {
    return (
      <>
        <button className="choice ghost" disabled={state === "loading"} onClick={() => void open()}>
          {state === "loading" ? "Finding pictures…" : "🖼️ Change your picture"}
        </button>
        {err && <div className="err">{err}</div>}
      </>
    );
  }
  return (
    <>
      <div className="sheet-h">Your picture</div>
      {state.options.length === 0 ? (
        <p className="pick-hint">No other pictures for your program.</p>
      ) : (
        <PictureGrid eventId={eventId} options={state.options} selected={initialPick(state.options, state.avatar)} onSelect={(key) => void choose(key)} />
      )}
      {err && <div className="err">{err}</div>}
    </>
  );
}
