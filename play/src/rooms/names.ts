//! The names the app already knows how to spell (wave 13 recheck): a
//! program the story declared `ICQ` or `VLC`, a guest who registered as
//! `ICQ`, a character listed in the directory. A speaker's raw name that
//! matches one shows as that name — `prettyName` recases only the raw ids
//! and screenplay cues that match nobody (`MODERATOR_PRIME` → "Moderator
//! Prime"), so `ICQ` never reads "Icq" next to Trabolta's lines that say ICQ.

import { createContext, useContext } from "react";
import { prettyName } from "./spaces.ts";

/** Folded name (case, `_` / `-` / spaces) → the name as the app knows it. */
export type KnownNames = ReadonlyMap<string, string>;

function fold(name: string): string {
  return name.toLowerCase().replace(/[_\s-]+/gu, " ").trim();
}

/** The known names from every list the view carries (roster, people, cast, the viewer); the first spelling of a name wins. */
export function knownNames(...lists: Array<Iterable<string | null | undefined> | null | undefined>): KnownNames {
  const out = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      if (typeof raw !== "string") continue;
      const name = raw.replace(/_/gu, " ").trim();
      const key = fold(name);
      if (key !== "" && !out.has(key)) out.set(key, name);
    }
  }
  return out;
}

/** A speaker's name for the screen: the known spelling when there is one, else `prettyName`. */
export function displayName(raw: string, known: KnownNames | null | undefined): string {
  const hit = known?.get(fold(raw));
  return hit ?? prettyName(raw);
}

const KnownNamesContext = createContext<KnownNames>(new Map());
/** The app's known names (the guest app provides them from its view; a booth may too). */
export const KnownNamesProvider = KnownNamesContext.Provider;
export function useKnownNames(): KnownNames {
  return useContext(KnownNamesContext);
}
