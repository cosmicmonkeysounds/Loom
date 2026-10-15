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
import { adoptResume, type ResumeLink } from "./resume.ts";
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
  // A director's re-pair QR (N-02): adopt that guest's session — it replaces
  // whatever guest this phone was before (a loaner, another browser).
  const [resuming, setResuming] = useState(resume !== null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  useEffect(() => {
    if (resume === null) return;
    void adoptResume(resume)
      .then((guest) => {
        localStorage.setItem("loom.guest", JSON.stringify(guest));
        setRole("guest");
      })
      .catch((e: unknown) => setResumeError(e instanceof Error ? e.message : "That re-pair code didn't work."))
      .finally(() => setResuming(false));
  }, [resume]);

  if (resuming) {
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
