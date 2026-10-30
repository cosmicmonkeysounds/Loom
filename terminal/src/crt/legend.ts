//! The CRT's button guide (wave 52b), pure: what the bottom of the screen says
//! the controller does right now. It only names what will work, so whatever
//! it shows is the whole of what a guest can do. The words are DRAFT w52b.

export type VoiceStepKind = "ready" | "listening" | "thinking" | "confirm" | "sending";

export interface Hint {
  /** The button, as it's printed on the controller. */
  key: string;
  label: string;
  /** Y: this hint is the button the controller's Y clicks. */
  file?: true;
  /** Start held: this hint is the button that clicks. */
  hold?: true;
}

export interface LegendIn {
  /** His name, in capitals. */
  who: string;
  /** He is talking: nothing may be picked, and nothing cuts him off. */
  speaking: boolean;
  /** The file panel is open. */
  files: boolean;
  /** The spoken composer's step; null: it isn't on screen. */
  voice: VoiceStepKind | null;
  /** Talking freely: B leaves it. */
  talking: boolean;
  /** A menu of answers is open. */
  menu: boolean;
  /** The door is open: the menu's answers are held. */
  greyed: boolean;
  /** A file can be given from here. */
  canGive: boolean;
  /** A scene's card covers the screen. */
  scene: boolean;
  /** It's asking for a pass. */
  prompt: boolean;
  /** The virtual keyboard is up. */
  typing: boolean;
  /** The line is about to drop: seconds left, or null. */
  warning: number | string | null;
}

export interface Legend {
  note: string | null;
  hints: Hint[];
}

const MOVE: Hint = { key: "▲▼", label: "CHOOSE" };
const SELECT: Hint = { key: "A", label: "SELECT" };
const BACK: Hint = { key: "B", label: "BACK" };
const GIVE: Hint = { key: "Y", label: "GIVE FILE", file: true };

export function legendFor(o: LegendIn): Legend {
  if (o.warning !== null) return { note: `STILL THERE? MOVE THE STICK · ${o.warning}`, hints: [] };
  if (o.scene) return { note: null, hints: [] };
  if (o.typing) return { note: null, hints: [{ key: "▲▼◄►", label: "MOVE" }, { key: "A", label: "TYPE" }, { key: "B", label: "DELETE" }] };
  if (o.prompt) return { note: null, hints: [{ key: "HOLD START", label: "TYPE YOUR NAME", hold: true }] };
  if (o.files) return { note: null, hints: [MOVE, SELECT, BACK] };
  if (o.speaking) return { note: `${o.who} IS SPEAKING`, hints: [] };
  const give = o.canGive ? [GIVE] : [];
  switch (o.voice) {
    case "listening":
      return { note: null, hints: [{ key: "A", label: "DONE" }, BACK] };
    case "thinking":
      return { note: null, hints: [BACK] };
    case "confirm":
      return { note: null, hints: [MOVE, SELECT, BACK] };
    case "sending":
      return { note: null, hints: [] };
    case "ready":
      return { note: null, hints: [{ key: "A", label: "SPEAK" }, ...(o.talking ? [BACK] : []), ...give] };
    default:
      break;
  }
  if (o.greyed) return { note: "CLOSE THE DOOR", hints: [] };
  if (o.menu) return { note: null, hints: [MOVE, SELECT, ...give] };
  return { note: `WAITING FOR ${o.who}`, hints: [] };
}
