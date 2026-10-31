//! The performer's sign-in: the code and the parts picker (moved out of
//! `performer.tsx` in wave 13).

import { useState } from "react";
import { HeldPanel } from "../held.tsx";
import { PersonAvatar } from "../ui/primitives.tsx";
import { avatarUrl, orderPicker, type IdentityRow } from "../avatars.ts";
import { codeFromUrl, useIdentities, type IdentityLookup } from "../session/shared.ts";
import type { PrimeSession } from "../session/prime.ts";

export function PrimeLogin({ session }: { session: PrimeSession }) {
  const [passcode, setPasscode] = useState(codeFromUrl);
  const [character, setCharacter] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Wave 59: a taken part tapped: it's one phone's, so a host moves it.
  const [askFor, setAskFor] = useState<string | null>(null);
  // A performer code resolves to the story's *parts* — every character
  // with something to do, minus the ones other booths already hold — so
  // the picker shows who is still free, with their pictures. Before the
  // story loads there is no cast to list: say so and re-ask.
  const lookup = useIdentities(passcode, (r) => r.role === "prime" && r.doorsOpen === false && r.identities.length === 0);
  const serverBusy = lookup.busy;
  // A guest code is not a performer code.
  const ids: IdentityLookup | null | "loading" =
    lookup.ids !== null && lookup.ids !== "loading" && (lookup.ids.kind === "ok" || lookup.ids.kind === "unavailable") && lookup.ids.role !== "prime" ? { kind: "unknown" } : lookup.ids;
  const resolved = ids !== null && ids !== "loading" && ids.kind === "ok" ? ids : null;
  const fallback = ids !== null && ids !== "loading" && ids.kind === "unavailable" ? ids : null;
  // An older server has no picker: offer its plain cast list (no claims, no pictures).
  const cast: IdentityRow[] =
    resolved !== null
      ? orderPicker(resolved.identities)
      : (fallback?.characters ?? []).map((name) => ({ name, faction: null, avatar: null, claimed: false }));
  const eventId = resolved?.eventId ?? fallback?.eventId ?? null;
  const waiting = resolved !== null && resolved.doorsOpen === false && cast.length === 0;
  const go = async (name = character) => {
    const who = name.trim();
    if (who === "" || busy) return;
    setBusy(true);
    setErr("");
    try {
      await session.login(who, passcode.trim());
    } catch (e) {
      setErr((e as Error).message);
      lookup.refresh(); // another booth may have just taken the part
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="hero">
      <div className="glyph">🎭</div>
      <h1>{resolved?.title ?? fallback?.title ?? "Performer station"}</h1>
      {session.notice && <p className="notice">{session.notice}</p>}
      <p className="sub">Sign in as your character. You'll speak as them everywhere.</p>
      <input
        type="password"
        placeholder="Performer passcode (from the host)"
        value={passcode}
        autoFocus={passcode === ""}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setPasscode(e.target.value)}
      />
      {ids === "loading" && <p className="pick-hint">Looking up the cast…</p>}
      {ids !== null && ids !== "loading" && ids.kind === "unknown" && passcode.trim().length >= 4 && <p className="pick-hint">That code doesn't open a performer station. Check it with your host.</p>}
      {serverBusy && <p className="pick-hint" role="status">The server is busy — trying again in a moment.</p>}
      {waiting && <p className="pick-hint" role="status">The story isn't loaded yet — the cast appears here once the director opens the doors.</p>}
      {fallback !== null && <p className="pick-hint">The server couldn't send who's still free — {fallback.error}. It may need a restart; the cast below is unfiltered.</p>}
      {askFor !== null ? (
        <HeldPanel card={{ code: passcode.trim(), by: { character: askFor }, name: askFor, ref: null }} onGuest={() => {}} onBooth={session.adopt} onBack={() => setAskFor(null)} />
      ) : cast.length > 0 ? (
        <div className="cast-pick" role="group" aria-label="Who are you tonight?">
          <div className="sheet-h">Who are you tonight?</div>
          {cast.some((c) => c.claimed) && <p className="pick-hint">Your part shows as taken after a lost phone? Tap it to ask a host.</p>}
          <div className="pick-grid">
            {cast.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`choice pick ${character === c.name ? "primary" : "ghost"} ${c.claimed ? "claimed" : ""}`}
                disabled={busy}
                title={c.claimed ? `${c.name} is taken — if it's yours, tap to ask a host` : `Be ${c.name}`}
                onClick={() => (c.claimed ? setAskFor(c.name) : void go(c.name))}
              >
                <PersonAvatar name={c.name} size="lg" kind="character" src={eventId !== null && c.avatar !== null ? avatarUrl(eventId, c.avatar) : null} />
                <span className="pick-label">
                  {c.name}
                  {c.faction !== null && <span className="pick-sub"> · {c.faction}</span>}
                  {c.claimed && <span className="pick-sub"> · taken</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <input
            placeholder="Character (as declared in the story)"
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void go()}
          />
          <button className="choice primary" onClick={() => void go()} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
