//! Root: the role chooser that mounts the guest or performer app. Each app
//! lives in its own module and composes the shared chat primitives.
//!
//! Branding is per-event: the title comes from `/api/resolve-code` (a `?code=`
//! link resolves before joining; a stored session keeps the title it joined
//! with) — nothing story-specific is baked into the client.

import { useEffect, useState } from "react";
import { GuestApp } from "./guest.tsx";
import { HelpSheet } from "./help.tsx";
import { PerformerApp } from "./performer.tsx";
import { adoptResume, storedGuestName, type ResumeLink } from "./resume.ts";
import { useDocumentTitle, useUrlEventTitle } from "./session.ts";

type Role = "none" | "guest" | "prime";

export function App({ resume = null }: { resume?: ResumeLink | null }) {
  const [role, setRole] = useState<Role>(() => {
    if (localStorage.getItem("loom.guest")) return "guest";
    if (localStorage.getItem("loom.prime")) return "prime";
    return "none";
  });
  const [help, setHelp] = useState(false);
  const urlTitle = useUrlEventTitle();
  useDocumentTitle(urlTitle);
  // A director's re-pair QR (N-02): trade its code for that guest's session.
  // A phone already signed in as a guest asks first — the link replaces it.
  const [pending, setPending] = useState<ResumeLink | null>(resume);
  const [confirmFor, setConfirmFor] = useState<string | null>(() => (resume === null ? null : storedGuestName(localStorage.getItem("loom.guest"))));
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
  if (role === "prime") return <PerformerApp onLeave={() => setRole("none")} />;

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
