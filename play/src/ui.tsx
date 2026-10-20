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

// A guest's first load is the guest app only (fix round): the booth (with
// the host console) and the director's cue sheet are their own chunks,
// fetched when a performer or a director opens this page.
const PerformerApp = lazy(() => import("./booth/app.tsx").then((m) => ({ default: m.PerformerApp })));
const DirectorApp = lazy(() => import("./director.tsx").then((m) => ({ default: m.DirectorApp })));

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
import { adoptResume, resumeToAdopt, storedGuestName, type ResumeLink } from "./resume.ts";
import { useDocumentTitle, useLandingBrand, useTheme } from "./session/shared.ts";

export function App({ resume = null }: { resume?: ResumeLink | null }) {
  // `?role=director` (W-26) opens the phone cue sheet whatever else the
  // phone holds; else the stored session.
  const [role, setRole] = useState<AppRole>(() => initialRole(window.location.search, (k) => localStorage.getItem(k)));
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
  const [pending, setPending] = useState<ResumeLink | null>(() => resumeToAdopt(resume, localStorage.getItem("loom.guest"), localStorage.getItem("loom.prime")));
  const [confirmFor, setConfirmFor] = useState<string | null>(() => (pending === null ? null : storedGuestName(localStorage.getItem("loom.guest"))));
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  useEffect(() => {
    if (pending === null || confirmFor !== null) return;
    setResuming(true);
    void adoptResume(pending)
      .then((guest) => {
        localStorage.setItem("loom.guest", JSON.stringify(guest));
        setRole("guest");
      })
      .catch((e: unknown) => setResumeError(e instanceof Error ? e.message : "That re-pair code didn't work."))
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

  if (resuming || pending !== null) {
    return (
      <div className="hero">
        <div className="glyph">🔁</div>
        <p className="sub">Getting you back in…</p>
      </div>
    );
  }

  if (role === "guest") return <GuestApp onLeave={() => setRole("none")} />;
  if (role === "prime")
    return (
      <Suspense fallback={<Loading />}>
        <PerformerApp onLeave={() => setRole("none")} />
      </Suspense>
    );
  if (role === "director")
    return (
      <Suspense fallback={<Loading />}>
        <DirectorApp onLeave={() => setRole("none")} brandTheme={brand.theme} />
      </Suspense>
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
      {help && <HelpSheet role="guest" onClose={() => setHelp(false)} />}
    </div>
  );
}
