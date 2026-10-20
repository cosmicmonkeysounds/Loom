//! The 🔔 "Get alerts" card and the profile-sheet row (K-31a). Both drive
//! `usePush` (`push.ts`); neither renders anything where push can't work
//! (embedded, no keys on the server) — except on an iPhone tab, which gets
//! what to do instead (K-31b): the Add-to-Home-Screen steps, or "keep the
//! app open".

import type { Push, PushState } from "./push.ts";
import { showPushCard } from "./push.ts";
import { wakeLockSupported } from "./wake-lock.ts";

/** What an iPhone card / row says (pure — `test/push.test.ts`). `booth`: a
 *  performer's icon signs in afresh, so they sign out of this tab first
 *  (that frees the part). `wakeLock`: the "Keep my screen on" item exists —
 *  under the guest's ⊞ Start, the booth's ☰ (Safari before iOS 16.4 has
 *  none — say Auto-Lock instead). */
export function iosPushCopy(
  state: PushState,
  booth: boolean,
  title?: string | null,
  wakeLock: boolean = wakeLockSupported(),
): { head: string; body: string } | null {
  const app = title ? title : "the app";
  if (state === "ios-install") {
    const then = booth
      ? "then ☰ → Sign out, and sign in from the Home Screen icon. Tap 🔔 there."
      : `then open ${app} from the new icon and tap 🔔 there. You'll still be you.`;
    return { head: "Get alerts on your iPhone", body: `tap Share → Add to Home Screen, ${then}` };
  }
  if (state === "ios-keep-open") {
    const how = wakeLock ? `${booth ? "☰" : "⊞ Start"} → Keep my screen on` : "Settings → Display & Brightness → Auto-Lock → Never";
    return { head: "Your iPhone can't get alerts", body: `keep ${app} open with the screen on (${how}).` };
  }
  return null;
}

/** Above the rooms until answered: one tap asks for permission (Android
 *  only shows the prompt from a gesture). `why` is the role's reason. */
export function PushCard({ push, why, booth = false, title }: { push: Push; why: string; booth?: boolean; title?: string | null }) {
  if (!showPushCard(push.state, push.dismissed)) return null;
  const ios = iosPushCopy(push.state, booth, title);
  if (ios !== null) {
    return (
      <div className="push-card" role="region" aria-label="Get alerts">
        <span className="push-glyph" aria-hidden>
          {push.state === "ios-install" ? "🔔" : "🔕"}
        </span>
        <span className="push-text">
          <b>{ios.head}</b> — {ios.body}
        </span>
        <button className="push-x" aria-label="Not now" onClick={push.dismiss}>
          ×
        </button>
      </div>
    );
  }
  return (
    <div className="push-card" role="region" aria-label="Get alerts">
      <span className="push-glyph" aria-hidden>
        🔔
      </span>
      <span className="push-text">
        <b>Get alerts</b> — {why}
      </span>
      <button className="push-on" onClick={push.enable}>
        Turn on
      </button>
      <button className="push-x" aria-label="Not now" onClick={push.dismiss}>
        ×
      </button>
    </div>
  );
}

/** The same switch in the profile sheet, with where it stands. */
export function PushRow({ push, booth = false, title }: { push: Push; booth?: boolean; title?: string | null }) {
  const ios = iosPushCopy(push.state, booth, title);
  if (ios !== null) {
    return (
      <div className="muted pad">
        {push.state === "ios-install" ? "🔔" : "🔕"} {ios.head} — {ios.body}
      </div>
    );
  }
  switch (push.state) {
    case "ask":
      return (
        <button className="choice" onClick={push.enable}>
          🔔 Get alerts on this phone (even when it's locked)
        </button>
      );
    case "working":
      return <div className="muted pad">🔔 Turning alerts on…</div>;
    case "on":
      return <div className="muted pad">🔔 Alerts are on — this phone buzzes even when it's locked.</div>;
    case "denied":
      return <div className="muted pad">🔕 Alerts are blocked. Allow notifications for this site in your browser's settings, then reopen the app.</div>;
    case "error":
      return (
        <button className="choice" onClick={push.enable}>
          🔔 Alerts didn't turn on — try again
        </button>
      );
    default:
      return null;
  }
}
