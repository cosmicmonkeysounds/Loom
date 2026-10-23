//! The multi-tenant event registry.
//!
//! One process can host many live events at once — one per project that has
//! opened its doors. `EventRegistry` maps a stable event id to its live
//! `EventRuntime`, and resolves a short passcode back to the event (and role)
//! it belongs to — the bootstrap a guest / performer / moderator needs before
//! they know which `/e/:eventId` to talk to.

import { join } from "node:path";

import { passOk, type Passcodes } from "./auth.ts";
import { Store } from "./store.ts";
import { EventRuntime } from "./event-runtime.ts";
import type { WikiClient } from "./wiki.ts";
import type { ImageCache } from "./avatars.ts";
import type { MapFiles, ProjectLink } from "./house-maps.ts";

/** The role a passcode grants when it resolves to an event. */
export type CodeRole = "guest" | "prime" | "mod";

/** A resolved passcode: which event it belongs to, and as which role. */
export interface ResolvedCode {
  eventId: string;
  role: CodeRole;
  /** The event's display title (authored `# Title`, else scenario name) —
   *  what the participant app shows instead of a baked-in brand. */
  title: string;
  /** The story's `theme:` for the participant client (`plain` when unset). */
  theme: string;
  /** For a performer / moderator code: the characters a performer may sign
   *  in as, so the booth offers a picker instead of a blank to spell, doors
   *  open or not (a booth signs in before the doors): a performer code
   *  lists the parts only (`EventRuntime.performerParts`); a moderator code
   *  the whole declared cast (a terminal provisioned then checks its
   *  `character` against it). */
  characters?: string[];
}

/** How to build a runtime the registry hasn't seen yet (for `ensure`). */
export interface EventSpec {
  eventId: string;
  codes: Passcodes;
  scenarioName: string;
  scenarioSource: string;
  /** A `preview` is an author's private rehearsal: hosted like any event,
   *  but never advertised (`landing`). Absent = live. */
  mode?: "live" | "preview";
  /** The project's map files snapshotted at launch (`event.house_maps`). */
  houseMaps?: MapFiles | null;
  /** The map variant the row records (`event.map_variant`) — a fresh state
   *  dir starts on it (a relaunch keeps the tent ↔ shed choice). */
  mapVariant?: string | null;
  /** The project's `facts.json` as the row snapshotted it (`facts.ts`):
   *  null = the project has none; absent = no row snapshot at all. */
  facts?: string | null;
  /** The project's `audio.json` as the row snapshotted it (`audio.ts`):
   *  null = the project has none; absent = no row snapshot at all. */
  audio?: string | null;
  /** The project's `lights.json` as the row snapshotted it (`lights.ts`):
   *  null = the project has none; absent = no row snapshot at all. */
  lights?: string | null;
  /** The way back to the project ("Save to project"); absent → none. */
  project?: ProjectLink | null;
  /** The reserved programs' claim secret the row pins (`event.claim_secret`);
   *  absent / null → the state dir's, else minted (and `onClaimSecret`). */
  claimSecret?: string | null;
  /** Keep a secret the runtime had to mint (writes it back to the row). */
  onClaimSecret?: (secret: string) => void;
}

export class EventRegistry {
  private readonly byId = new Map<string, EventRuntime>();
  /** Hosted events that are private previews (see `EventSpec.mode`). */
  private readonly previews = new Set<string>();

  /**
   * @param stateDir base directory; each event journals under `stateDir/<id>`.
   * @param joinBase best base URL for guest-join QRs (per-event codes view).
   */
  /**
   * @param wiki the program directory every hosted event looks pictures up
   *   in (and guests search); null keeps every event offline.
   * @param images the picture cache every hosted event serves from (one
   *   per process; the runtime's own default when omitted).
   */
  constructor(
    private readonly stateDir: string,
    private readonly joinBase: () => string,
    private readonly wiki: WikiClient | null = null,
    private readonly images: ImageCache | null = null,
  ) {}

  /** Attach an already-constructed runtime (e.g. the default event). */
  register(runtime: EventRuntime): EventRuntime {
    this.byId.set(runtime.eventId, runtime);
    return runtime;
  }

  /** The runtime for an event id, or undefined if it isn't hosted here. */
  get(eventId: string): EventRuntime | undefined {
    return this.byId.get(eventId);
  }

  /** Every hosted runtime. */
  all(): EventRuntime[] {
    return [...this.byId.values()];
  }

  /** Is this event currently hosted? */
  has(eventId: string): boolean {
    return this.byId.has(eventId);
  }

  /**
   * Get the runtime for `spec.eventId`, constructing + registering (and
   * restoring from disk) one if it isn't hosted yet. Idempotent.
   */
  ensure(spec: EventSpec): EventRuntime {
    // The mode follows the latest spec (a go-live promotes in place).
    if (spec.mode === "preview") this.previews.add(spec.eventId);
    else if (spec.mode === "live") this.previews.delete(spec.eventId);
    const existing = this.byId.get(spec.eventId);
    if (existing) return existing;
    const runtime = new EventRuntime({
      eventId: spec.eventId,
      store: new Store(join(this.stateDir, spec.eventId)),
      codes: spec.codes,
      scenarioName: spec.scenarioName,
      scenarioSource: spec.scenarioSource,
      houseMaps: spec.houseMaps ?? null,
      mapVariant: spec.mapVariant ?? null,
      ...(spec.facts !== undefined ? { facts: spec.facts } : {}),
      ...(spec.audio !== undefined ? { audio: spec.audio } : {}),
      ...(spec.lights !== undefined ? { lights: spec.lights } : {}),
      project: spec.project ?? null,
      ...(spec.claimSecret !== undefined ? { claimSecret: spec.claimSecret } : {}),
      ...(spec.onClaimSecret !== undefined ? { onClaimSecret: spec.onClaimSecret } : {}),
      joinBase: this.joinBase,
      wiki: this.wiki,
      ...(this.images !== null ? { images: this.images } : {}),
    });
    runtime.restore();
    return this.register(runtime);
  }

  /** Stop hosting an event: dispose its runtime and drop it. `by` names the
   *  director who ended it (rides the `lifecycle` notice). */
  stop(eventId: string, by?: string): void {
    const runtime = this.byId.get(eventId);
    if (runtime) {
      runtime.dispose(by);
      this.byId.delete(eventId);
      this.previews.delete(eventId);
    }
  }

  /**
   * The branding for the bare landing page (someone who typed the address,
   * no code yet): the one event whose doors are open, if exactly one is —
   * its title and skin, never a code. Null when none or several are open.
   * A private preview never counts: an author's rehearsal is nobody's
   * business on an unauthenticated route. (The default / LAN event does —
   * on a LAN-only server it is the show.)
   */
  landing(): { title: string; theme: string } | null {
    const open = [...this.byId.values()].filter((rt) => rt.currentPhase === "open" && !this.previews.has(rt.eventId));
    if (open.length !== 1) return null;
    return { title: open[0]!.title, theme: open[0]!.theme };
  }

  /**
   * Resolve a short passcode to the event + role it grants. Guests use an
   * event's `event` code, performers its `prime` code, moderators its `mod`
   * code. Codes are globally unique across live events, so the first match
   * wins. Returns null when no hosted event recognises the code.
   */
  resolveCode(code: string): ResolvedCode | null {
    const trimmed = code.trim();
    if (trimmed === "") return null;
    for (const rt of this.byId.values()) {
      if (passOk(trimmed, rt.codes.event)) return { eventId: rt.eventId, role: "guest", title: rt.title, theme: rt.theme };
      if (passOk(trimmed, rt.codes.prime)) return { eventId: rt.eventId, role: "prime", title: rt.title, theme: rt.theme, characters: rt.performerParts };
      if (passOk(trimmed, rt.codes.mod)) return { eventId: rt.eventId, role: "mod", title: rt.title, theme: rt.theme, characters: rt.declaredCharacters };
    }
    return null;
  }
}
