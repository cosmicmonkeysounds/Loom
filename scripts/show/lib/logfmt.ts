//! `showctl log`: one line per ledger entry (`GET /api/mod/log`, the same
//! `SimEvent`s Run → Log shows), filtered by type and by person.
//!
//! The ledger is the director's whole truth, secrets included: a
//! `worldSet` on the Kernel carries the night's combos and the door code.
//! Run masks a `secret: true` character's values wherever they show; so
//! does this — any `worldSet` whose path starts with a secret cast member
//! (`ModView.cast[].secret`), or names a code (`door_code`, `combo_…`),
//! prints its value as `•••`.

type Json = Record<string, unknown>;

/** World paths whose values are always masked, secret owner or not. */
const SECRET_LEAF = /(^|\.)(door_code|combo_[a-z]|combo|code)$/iu;

/** Is this world path one whose value must never print? */
export function isSecretPath(path: string, secretHeads: ReadonlySet<string>): boolean {
  const head = path.split(".")[0] ?? "";
  return secretHeads.has(head.toLowerCase()) || SECRET_LEAF.test(path);
}

/** The entry as it may leave this tool: a secret `worldSet`'s value (and
 *  its `prev`, when it carries one) replaced by `•••`. Every output — the
 *  text lines, `--json`, `--follow` — goes through here first. */
export function maskEntry(e: Json, secretHeads: ReadonlySet<string>): Json {
  if (e["type"] !== "worldSet" || !isSecretPath(String(e["path"] ?? ""), secretHeads)) return e;
  const out: Json = { ...e, value: "•••" };
  if ("prev" in out) out["prev"] = "•••";
  return out;
}

/** Who an entry is about: every person / speaker field it carries. */
export function entryPeople(e: Json): string[] {
  return ["person", "subject", "speaker", "from", "scanner", "by", "to"].map((k) => e[k]).filter((v): v is string => typeof v === "string" && v !== "");
}

const clip = (s: unknown, n = 140) => {
  const t = String(s ?? "").replace(/\s+/gu, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** One entry as a line: `#seq type  summary`. `names` turns ids into names. */
export function formatEntry(seq: number, e: Json, secretHeads: ReadonlySet<string>, names: ReadonlyMap<string, string> = new Map()): string {
  const who = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? id) : "—");
  const type = String(e["type"] ?? "?");
  let text: string;
  switch (type) {
    case "worldSet": {
      const path = String(e["path"] ?? "");
      text = `${path} = ${isSecretPath(path, secretHeads) ? "•••" : clip(e["value"], 60)}`;
      break;
    }
    case "dialogue":
      text = `${String(e["speaker"])}: ${clip(e["text"])}`;
      break;
    case "action":
      text = clip(e["text"]);
      break;
    case "chat":
      text = `${String(e["from"])} in ${String(e["channel"])}: ${clip(e["text"])}`;
      break;
    case "beatEntered":
      text = `${String(e["beat"])}${e["subject"] ? ` for ${who(e["subject"])}` : ""}${e["setting"] ? ` @ ${String(e["setting"])}` : ""}`;
      break;
    case "signal":
    case "fire":
      text = `${String(e["name"] ?? e["signal"] ?? "")}${e["subject"] ? ` for ${who(e["subject"])}` : ""}${e["by"] ? ` by ${String(e["by"])}` : ""}`;
      break;
    case "directive":
      text = `${String(e["verb"])} ${clip(e["args"], 100)}`;
      break;
    case "broadcast":
      text = `${clip(e["cue"])} → ${String(e["scope"] ?? "")}`;
      break;
    default: {
      // Everything else: its scalar fields, people named.
      const parts = Object.entries(e)
        .filter(([k, v]) => k !== "type" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
        .map(([k, v]) => `${k}=${["person", "subject", "by", "scanner"].includes(k) ? who(v) : clip(v, 50)}`);
      text = parts.join(" ");
    }
  }
  return `#${String(seq).padStart(5)} ${type.padEnd(14)} ${text}`;
}

/** Does an entry pass `--type a,b` and `--who x` (an id or a name, folded)? */
export function entryMatches(e: Json, types: readonly string[], who: string | null, names: ReadonlyMap<string, string>): boolean {
  if (types.length > 0 && !types.includes(String(e["type"]))) return false;
  if (who === null) return true;
  const want = who.trim().toLowerCase();
  return entryPeople(e).some((p) => p.toLowerCase() === want || (names.get(p) ?? "").toLowerCase() === want);
}
