// The shared teleprompter's eager part (wave 59, `docs/loom-w59-prompter-contract.md`).
// The server keeps one position per scene, in words from its start: it sends a
// `prompter` frame on every change, and between frames a phone adds `rate` a
// second from the frame's arrival, up to `stop`. A store per session, never a
// module global (Run → Players mounts many phones in one page), and read by a
// subscription, so five moves a second never re-render the app.

import type { ScriptLine, ScriptSection } from "./model.ts";

export interface PrompterLine {
  seq: number;
  ts: number;
  speaker: string;
  text: string;
  manner: string | null;
  who: string;
  his: boolean;
}

export interface PrompterFrame {
  id: number;
  rev: number;
  pos: number;
  rate: number;
  stop: number;
  total: number;
  playing: boolean;
  speed: number;
  holder: { who: string; name: string } | null;
  speaking: { name: string; seq: number } | null;
  held: boolean;
  done?: true;
  superseded?: true;
  script?: { sections: Array<{ title: string; lines: PrompterLine[] }>; readers: string[]; owners: string[] };
}

export type PrompterPost = (body: Record<string, unknown>) => Promise<unknown>;

export class PrompterStore {
  /** The live scene's newest frame. */
  frame: PrompterFrame | null = null;
  script: NonNullable<PrompterFrame["script"]> | null = null;
  /** When `frame` arrived (`performance.now`). */
  arrived = 0;
  /** The last scene to end, and how. */
  ended: { id: number; superseded: boolean } | null = null;
  private readonly subs = new Set<() => void>();
  private before: PrompterFrame | null = null;

  readonly subscribe = (f: () => void): (() => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };

  /** The frame's id, or 0: what the app's own render depends on. */
  readonly sceneId = (): number => (this.script !== null ? (this.frame?.id ?? 0) : 0);

  /** A frame, or null: no scene is on. */
  set(f: PrompterFrame | null): void {
    if (f === null || f.done === true) {
      if (this.frame !== null) this.ended = { id: this.frame.id, superseded: f?.superseded === true };
      this.frame = null;
      this.script = null;
    } else {
      if (f.script !== undefined) this.script = f.script;
      else if (this.frame?.id !== f.id && this.script !== null) this.script = null;
      this.frame = f;
      this.arrived = performance.now();
    }
    this.before = null;
    for (const s of this.subs) s();
  }

  /** Where it is now. */
  pos(now: number): number {
    const f = this.frame;
    return f === null ? 0 : Math.min(f.stop, f.pos + (f.rate * Math.max(0, now - this.arrived)) / 1000);
  }

  /** This phone moved it: follow that until the server answers. */
  nudge(pos: number): void {
    if (this.frame === null) return;
    this.before ??= this.frame;
    this.frame = { ...this.frame, pos, rate: 0 };
    this.arrived = performance.now();
  }

  /** The server refused it. */
  revert(): void {
    if (this.before !== null) this.frame = this.before;
    this.before = null;
    for (const s of this.subs) s();
  }
}

/** The scene's lines as this phone's script. */
export function sceneScript(script: NonNullable<PrompterFrame["script"]>, me: string): ScriptSection[] {
  return script.sections.map((s) => ({ title: s.title, lines: s.lines.map((l): ScriptLine => ({ seq: l.seq, ts: l.ts, speaker: l.speaker, text: l.text, manner: l.manner, mine: l.who === me, his: l.his })) }));
}

/** What this phone is to the scene. */
export function sceneRole(script: NonNullable<PrompterFrame["script"]> | null, me: string | null): "reader" | "owner" | "host" | null {
  if (script === null || me === null) return null;
  return script.readers.includes(me) ? "reader" : script.owners.includes(me) ? "owner" : "host";
}
