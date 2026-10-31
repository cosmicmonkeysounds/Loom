//! Root: the role chooser that mounts the guest or performer app. Each app
//! lives in its own module and composes the shared chat primitives.
//!
//! Branding is per-event: the title comes from `/api/resolve-code` (a `?code=`
//! link resolves before joining; a stored session keeps the title it joined
//! with), or — the bare address, typed in — from `/api/landing` (the one
//! event with its doors open). Nothing story-specific is baked into the client.

import { Suspense, lazy, useEffect, useState } from "react";
import { GuestApp } from "./guest/app.tsx";
import { LazyHelpSheet as HelpSheet } from "./help-lazy.tsx";
import { initialRole, roleForBrand, type AppRole } from "./app-role.ts";
import { ChunkBoundary, ChunkDown, ChunkFailed, chunkOrDown, retryImport } from "./lazy-chunk.tsx";
import { resumeToAdopt, storedGuestName, type ResumeLink } from "./resume.ts";
import { cardPlan, heldOf, letGo, rememberBadge, settleOwed, type CardLink, type HeldCard } from "./rejoin.ts";
import { claimField, claimFromSearch, rememberClaim } from "./claim.ts";
import { codeFromUrl, tokenDead, useDocumentTitle, useLandingBrand, useTheme } from "./session/shared.ts";
import { browserHost } from "./host.ts";

// A guest's first load is the guest app only (fix round): the booth (with
// the host console) and the director's cue sheet are their own chunks,
// fetched when a performer or a director opens this page. A fetch that fails is tried once more, then the page says so with a
// Reload (a page left open across a deploy asks for chunks that are gone).
const PerformerApp = lazy(retryImport(() => import("./booth/app.tsx").then((m) => ({ default: m.PerformerApp }))));
// Wave 23: the calls behind a badge / invitation / cast-card link, fetched
// only when the page opened with one.
const loadRejoinCalls = chunkOrDown(() => import("./rejoin-calls.ts"));
const DirectorApp = lazy(retryImport(() => import("./director.tsx").then((m) => ({ default: m.DirectorApp }))));
// Wave 59: a card a phone already holds. Only a refused page fetches it.
const HeldPanel = lazy(retryImport(() => import("./held.tsx").then((m) => ({ default: m.HeldPanel }))));

/** What shows while a lazily loaded app arrives. */
function Loading() {
  return (
    <div className="root">
      <div className="hero">
        <div className="glyph">📡</div>
        <p className="sub">Loading…</p>
      </div>
    </div>
  );
}

/** A stored session as its raw JSON, or null — through the page's store,
 *  which never throws (a blocked `localStorage` reads as empty). */
function storedRaw(key: string): string | null {
  const v = browserHost.storage.load<unknown>(key);
  return v === null ? null : JSON.stringify(v);
}

/** The token a stored session holds: on a re-scan it proves this phone is the holder. */
function storedToken(key: string): string | undefined {
  const token = browserHost.storage.load<{ token?: unknown }>(key)?.token;
  return typeof token === "string" ? token : undefined;
}

/** A sign-in the page opened with (wave 23): a badge, an invitation, a cast
 *  card, or a badge on a phone that says it has a guest (`link`: wave 59
 *  checks that session first). */
type Entry = { kind: "badge"; code: string; badge: string; claim: string | null } | { kind: "link"; code: string; badge: string; claim: string | null } | { kind: "claim"; code: string; claim: string } | { kind: "part"; code: string; part: string };

/** What the page's link asks to sign in as, before any app mounts. */
function entryFor(card: CardLink | null, search: string, stored: (k: string) => string | null): { entry: Entry | null; confirm: string | null } {
  const guestName = storedGuestName(stored("loom.guest"));
  const plan = cardPlan(card, guestName, (stored("loom.prime") ?? "") !== "");
  if (plan.kind === "enter") return { entry: { kind: "badge", code: plan.code, badge: plan.badge, claim: claimFromSearch(search) }, confirm: null };
  if (plan.kind === "part") return { entry: { kind: "part", code: plan.code, part: plan.part }, confirm: plan.confirm };
  if (plan.kind === "link") return { entry: { kind: "link", code: card!.code, badge: plan.badge, claim: claimFromSearch(search) }, confirm: null };
  // An invitation opened with no session: its program may have joined
  // already (a featured guest who lost their phone) — in at once if so.
  const claim = claimFromSearch(search);
  const code = codeFromUrl();
  if (claim !== null && code !== "" && guestName === null && (stored("loom.prime") ?? "") === "") return { entry: { kind: "claim", code, claim }, confirm: null };
  return { entry: null, confirm: null };
}

export function App({ resume = null, card = null }: { resume?: ResumeLink | null; card?: CardLink | null }) {
  // `?role=director` (W-26) opens the phone cue sheet whatever else the
  // phone holds; else the stored session.
  const [role, setRole] = useState<AppRole>(() => initialRole(window.location.search, storedRaw));
  const [help, setHelp] = useState(false);
  // A `?code=` link's event, else the one open event: the bare address
  // reads as the show, skinned, before anyone joins.
  const brand = useLandingBrand();
  const urlTitle = brand.title;
  useDocumentTitle(urlTitle);
  // The chooser's skin; a guest / performer app skins itself (the landing's
  // theme on its join screen, the story's once signed in).
  useTheme(brand.theme, role === "none");
  // A `?code=` link carrying the mod code opens the director's cue sheet.
  // The guests' front page has no link to it (W-26).
  useEffect(() => {
    setRole((r) => roleForBrand(r, brand.role));
  }, [brand.role]);
  // A director's re-pair QR (N-02): trade its code for that guest's session.
  // A phone already signed in as a guest asks first — the link replaces it.
  // A Home Screen icon reopening on its spent nonce (K-31b) is just dropped.
  const [pending, setPending] = useState<ResumeLink | null>(() => resumeToAdopt(resume, storedRaw("loom.guest"), storedRaw("loom.prime")));
  const [confirmFor, setConfirmFor] = useState<string | null>(() => (pending === null ? null : storedGuestName(storedRaw("loom.guest"))));
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // The chunk behind a card or a re-pair link wouldn't load: Reload, not the
  // browser's own words.
  const [chunkDown, setChunkDown] = useState(false);
  // A badge, an invitation or a cast card (wave 23): sign in by it first.
  const [first] = useState(() => entryFor(card, window.location.search, storedRaw));
  const [entry, setEntry] = useState<Entry | null>(first.entry);
  const [entryConfirm, setEntryConfirm] = useState<string | null>(first.confirm);
  // A signed-in guest's badge link: the guest app links it (or reads it as a pass).
  const [badgeLink, setBadgeLink] = useState<string | null>(null);
  // Wave 59: the card this page opened with is held by a phone.
  const [held, setHeld] = useState<HeldCard | null>(null);
  /** This phone is a booth now: whoever it was lets go of their card. */
  const adoptBooth = (booth: { token: string }) => {
    const before = browserHost.storage.load<{ token?: unknown; eventId?: unknown }>("loom.prime");
    letGo(browserHost.storage, browserHost.storage.load<{ token?: unknown; eventId?: unknown }>("loom.guest"), "guest");
    if (before?.token !== booth.token) letGo(browserHost.storage, before, "prime");
    browserHost.storage.drop("loom.guest");
    browserHost.storage.save("loom.prime", booth);
    setHeld(null);
    setRole("prime");
  };
  // A sign-out this phone owes (Leave with no signal): told as soon as the
  // server is there, or its own badge would read as held.
  useEffect(() => {
    const pay = () => void settleOwed(browserHost.storage);
    pay();
    window.addEventListener("online", pay);
    return () => window.removeEventListener("online", pay);
  }, []);
  useEffect(() => {
    if (entry === null || entryConfirm !== null) return;
    let live = true;
    const done = () => {
      if (live) setEntry(null);
    };
    if (entry.kind === "link") {
      // A session that died while the phone slept (a release, a move) is no
      // session: the card decides, in or the refused screen, never the join.
      const stored = browserHost.storage.load<{ token?: unknown; eventId?: unknown }>("loom.guest");
      void tokenDead(`/e/${encodeURIComponent(String(stored?.eventId ?? ""))}`, "guest", String(stored?.token ?? "")).then((dead) => {
        if (!live) return;
        if (dead === null) {
          setBadgeLink(entry.badge);
          setEntry(null);
        } else {
          browserHost.storage.drop("loom.guest");
          setEntry({ ...entry, kind: "badge" });
        }
      });
    } else if (entry.kind === "part") {
      void loadRejoinCalls()
        .then(async (m) => {
          await m.payOwed(browserHost.storage);
          return m.enterPart(entry.code, entry.part, undefined, storedToken("loom.prime"));
        })
        .then(adoptBooth)
        .catch((e: unknown) => {
          const shown = heldOf(e);
          if (shown !== null) return setHeld({ code: entry.code, by: { part: entry.part }, ...shown });
          if (e instanceof ChunkDown) setChunkDown(true);
          else setResumeError(e instanceof Error ? e.message : "That staff badge didn't work.");
          setRole("none");
        })
        .finally(done);
    } else {
      const by = entry.kind === "badge" ? { badge: entry.badge, ...claimField(entry.claim) } : { claim: entry.claim };
      void loadRejoinCalls()
        .then(async (m) => {
          await m.payOwed(browserHost.storage);
          return m.enterBy(entry.code, by, undefined, storedToken("loom.guest"));
        })
        .then((r) => {
          if (r.kind === "in") browserHost.storage.save("loom.guest", r.guest);
          else if (entry.kind === "badge") {
            // A blank badge rides into the join and links to the program
            // picked; an invited one takes its invitation with it.
            rememberBadge(browserHost.storage, entry.code, entry.badge);
            rememberClaim(browserHost.storage, entry.code, r.claim);
          }
          setRole("guest");
        })
        .catch((e: unknown) => {
          const shown = heldOf(e);
          // An invitation that won't re-enter still opens the join as before.
          if (shown !== null) setHeld({ code: entry.code, by, ...shown });
          else if (entry.kind === "claim") setRole("guest");
          else {
            if (e instanceof ChunkDown) setChunkDown(true);
            else setResumeError(e instanceof Error ? e.message : "That badge didn't work.");
            setRole("none");
          }
        })
        .finally(done);
    }
    return () => {
      live = false;
    };
  }, [entry, entryConfirm]);
  useEffect(() => {
    if (pending === null || confirmFor !== null) return;
    setResuming(true);
    void loadRejoinCalls()
      .then(async (m) => {
        const guest = await m.adoptResume(pending);
        // "Switch this phone": the guest it was lets go of their card.
        const before = browserHost.storage.load<{ id?: unknown; token?: unknown; eventId?: unknown }>("loom.guest");
        if (before?.id !== guest.id) letGo(browserHost.storage, before, "guest");
        return guest;
      })
      .then((guest) => {
        browserHost.storage.save("loom.guest", guest);
        setRole("guest");
      })
      .catch((e: unknown) => {
        if (e instanceof ChunkDown) setChunkDown(true);
        else setResumeError(e instanceof Error ? e.message : "That re-pair code didn't work.");
      })
      .finally(() => {
        setResuming(false);
        setPending(null);
      });
  }, [pending, confirmFor]);

  if (pending !== null && confirmFor !== null) {
    return (
      <div className="hero">
        <div className="glyph">🔁</div>
        <p className="sub">This phone is signed in as {confirmFor}. The code you scanned signs it in as someone else.</p>
        <button className="choice primary" onClick={() => setConfirmFor(null)}>
          Switch this phone
        </button>
        <button
          className="choice ghost"
          onClick={() => {
            setPending(null);
            setConfirmFor(null);
          }}
        >
          Stay {confirmFor}
        </button>
      </div>
    );
  }

  if (entry !== null && entryConfirm !== null) {
    return (
      <div className="hero">
        <div className="glyph">🎭</div>
        <p className="sub">This phone is signed in as {entryConfirm}. That's a staff badge. If it's someone else's, leave it alone: switching signs them out.</p>
        <button
          className="choice primary"
          onClick={() => {
            setEntry(null);
            setEntryConfirm(null);
          }}
        >
          Stay {entryConfirm}
        </button>
        <button className="choice ghost" onClick={() => setEntryConfirm(null)}>
          It's my badge: switch this phone
        </button>
      </div>
    );
  }

  if (resuming || pending !== null || entry !== null) {
    return (
      <div className="hero">
        <div className="glyph">🔁</div>
        <p className="sub">Getting you back in…</p>
      </div>
    );
  }

  if (chunkDown) return <ChunkFailed what="This page" onBack={() => setChunkDown(false)} />;

  if (held !== null) {
    return (
      <div className="hero">
        <div className="glyph">🔒</div>
        <ChunkBoundary fallback={() => <ChunkFailed what="This page" onBack={() => setHeld(null)} />}>
          <Suspense fallback={<p className="sub">One moment…</p>}>
            <HeldPanel
              card={held}
              onGuest={(guest) => {
                browserHost.storage.save("loom.guest", guest);
                setHeld(null);
                setRole("guest");
              }}
              onBooth={adoptBooth}
              onBack={() => setHeld(null)}
            />
          </Suspense>
        </ChunkBoundary>
      </div>
    );
  }

  if (role === "guest") return <GuestApp onLeave={() => setRole("none")} badgeLink={badgeLink} />;
  if (role === "prime")
    return (
      <ChunkBoundary fallback={() => <ChunkFailed what="The booth" onBack={() => setRole("none")} />}>
        <Suspense fallback={<Loading />}>
          <PerformerApp onLeave={() => setRole("none")} />
        </Suspense>
      </ChunkBoundary>
    );
  if (role === "director")
    return (
      <ChunkBoundary fallback={() => <ChunkFailed what="The cue sheet" onBack={() => setRole("none")} />}>
        <Suspense fallback={<Loading />}>
          <DirectorApp onLeave={() => setRole("none")} brandTheme={brand.theme} />
        </Suspense>
      </ChunkBoundary>
    );

  return (
    <div className="hero">
      <div className="glyph">🌐</div>
      <h1>{urlTitle ?? "Loom"}</h1>
      {resumeError !== null && <p className="sub">{resumeError}</p>}
      <p className="sub">Who are you tonight?</p>
      <button className="choice primary" onClick={() => setRole("guest")}>
        🎟️ I'm a Guest
      </button>
      <button className="choice ghost" onClick={() => setRole("prime")}>
        🎭 I'm a Performer
      </button>
      <button className="link" onClick={() => setHelp(true)}>
        ? What is this
      </button>
      {help && <HelpSheet onClose={() => setHelp(false)} />}
    </div>
  );
}
