//! What a scene needs to ask the server something itself (wave 44, C8): the
//! event's base path and the terminal's mod token. Scenes are handed the
//! screen state only, and the cutscene layer lives in its own lazy chunk,
//! so the app (`app.tsx`) puts its config's access here and a scene that
//! fetches (the credits: `credits-fetch.ts`) reads it. Base bundle: a few
//! lines. Null until the terminal is provisioned (and in the preview).

export interface SceneAccess {
  /** `/e/<eventId>` (`config.ts` `baseOf`). */
  base: string;
  /** The terminal's mod token (`x-loom-token`). */
  token: string;
}

let access: SceneAccess | null = null;

/** The app's config changed (null: none, or set up again). */
export function setSceneAccess(a: SceneAccess | null): void {
  access = a === null || a.base === "" || a.token === "" ? null : { base: a.base, token: a.token };
}

/** The terminal's access now, or null. */
export function sceneAccess(): SceneAccess | null {
  return access;
}
