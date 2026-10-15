//! The 🔔 "Get alerts" card and the profile-sheet row (K-31a). Both drive
//! `usePush` (`push.ts`); neither renders anything where push can't work
//! (embedded, no Push API, no keys on the server).

import type { Push } from "./push.ts";
import { showPushCard } from "./push.ts";

/** Above the rooms until answered: one tap asks for permission (Android
 *  only shows the prompt from a gesture). `why` is the role's reason. */
export function PushCard({ push, why }: { push: Push; why: string }) {
  if (!showPushCard(push.state, push.dismissed)) return null;
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
export function PushRow({ push }: { push: Push }) {
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
