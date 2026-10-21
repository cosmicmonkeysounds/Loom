//! Operator sessions = a token plus the **capabilities** it carries.
//!
//! Capabilities are additive and compose on a single session, so roles are
//! not mutually exclusive:
//!   - a **performer** holds a `character` (the identity they scan as);
//!   - an **admin** holds the moderator capability (open doors, moderate,
//!     scan-to-moderate);
//!   - a performer who also enters the moderator passcode keeps the *same*
//!     token and gains `admin` — "a performer can also be an admin";
//!   - a `{ character: null, admin: true }` session is a **headless admin**
//!     (an operator with a scanner but no character/booth);
//!   - a **host** (wave 13) holds the host capability, granted by signing in
//!     as a part the story marks `admin: true` (Task Manager): the cue sheet,
//!     judging, announcements, the alert dial — a fixed allowlist of mod
//!     routes, never the god view. It lives and dies with that part:
//!     `revokeHost` on a switch to another part, `dropCharacter` on Release,
//!     Sign out and Go live (a host-only session is deleted, never left as a
//!     headless admin).
//!
//! Kept out of the HTTP layer — and free of token *generation*, which the
//! server owns — so the capability rules stay pure and unit-testable.

export interface Session {
  /** Performer identity (the character they scan as), or null if headless. */
  character: string | null;
  /** The moderator capability — the mod passcode or (via opts.moderator) the author. Unchanged meaning. */
  admin: boolean;
  /** The host capability, granted by signing in as a part with
   *  `admin: true` (`/api/prime/login`); it lives and dies with that part. */
  host: boolean;
  /** Wave 18 (C8): the **caller** capability — the part is named by some
   *  `who: admin` INTERACTION's `by:` (Clippy calls its games), so the booth
   *  may press those cues (`POST /api/prime/cue`). Granted at sign-in,
   *  re-derived on every story load, gone with the part (Release, Sign out,
   *  Go live). Optional on the wire: an older store reads as false. */
  caller?: boolean;
}

export class SessionStore {
  private byToken = new Map<string, Session>();

  /** Create (or replace) the session for a token. */
  set(token: string, session: Session): void {
    this.byToken.set(token, { character: session.character, admin: session.admin, host: session.host === true, ...(session.caller === true ? { caller: true } : {}) });
  }

  /**
   * Merge capabilities into an existing session. Returns false if the token
   * is unknown. `admin` / `host` are OR-ed in (never revoked here);
   * `character` is set when provided — this is how a performer upgrades to
   * performer+admin, or an admin picks up a character.
   */
  grant(token: string, patch: Partial<Session>): boolean {
    const s = this.byToken.get(token);
    if (s === undefined) return false;
    if (patch.character !== undefined) s.character = patch.character;
    if (patch.admin === true) s.admin = true;
    if (patch.host === true) s.host = true;
    if (patch.caller === true) s.caller = true;
    return true;
  }

  /** Drop the caller capability (a part no `by:` names any more). */
  revokeCaller(token: string): void {
    const s = this.byToken.get(token);
    if (s !== undefined) delete s.caller;
  }

  /** May this token call `who: admin` cues its part is named on (C8)? */
  canCall(token: string | undefined): boolean {
    return this.get(token)?.caller === true;
  }

  /** Drop part-granted host (a re-sign-in to a part without `admin: true`). Admin is kept. */
  revokeHost(token: string): void {
    const s = this.byToken.get(token);
    if (s !== undefined) s.host = false;
  }

  /**
   * Take the character off a session: a session with `admin` keeps admin
   * with `character: null, host: false`; any other session (performer-only
   * or performer + host) is **deleted** — so a host part never turns into a
   * headless admin. Go live, Release and Sign out use it.
   */
  dropCharacter(token: string): void {
    const s = this.byToken.get(token);
    if (s === undefined) return;
    if (s.admin) this.byToken.set(token, { character: null, admin: true, host: false });
    else this.byToken.delete(token);
  }

  get(token: string | undefined): Session | undefined {
    return token ? this.byToken.get(token) : undefined;
  }
  has(token: string | undefined): boolean {
    return !!token && this.byToken.has(token);
  }
  delete(token: string): void {
    this.byToken.delete(token);
  }

  // --- capability predicates ---------------------------------------------

  /** Can this token scan a guest at all? (performer OR admin) */
  canScan(token: string | undefined): boolean {
    const s = this.get(token);
    return s !== undefined && (s.character !== null || s.admin);
  }
  /** Can this token perform moderator/admin actions? */
  canModerate(token: string | undefined): boolean {
    return this.get(token)?.admin === true;
  }
  /** May this token use the host allowlist (`canModerate || host`)? */
  canHost(token: string | undefined): boolean {
    const s = this.get(token);
    return s !== undefined && (s.admin || s.host);
  }
  /** The character a token scans as, or null when headless. */
  characterOf(token: string | undefined): string | null {
    return this.get(token)?.character ?? null;
  }

  // --- persistence -------------------------------------------------------

  entries(): Array<[string, Session]> {
    return [...this.byToken.entries()].map(([t, s]) => [t, { ...s }]);
  }
  load(entries: Array<[string, Session]>): void {
    if (!Array.isArray(entries)) return; // tolerate a stale/incompatible store
    for (const [t, s] of entries) {
      this.byToken.set(t, { character: s.character ?? null, admin: s.admin === true, host: (s as Partial<Session>).host === true, ...((s as Partial<Session>).caller === true ? { caller: true } : {}) });
    }
  }
}
