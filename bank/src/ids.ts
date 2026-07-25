//! FNV-1a 64 name hashing + collision detection.
//!
//! 64-bit rather than Wwise's 32: at ~10k names a 32-bit space carries a
//! ~1.2% chance of at least one collision per project, and a collision
//! here would silently reroute a divert. The width costs nothing in the
//! instruction stream because opcodes address a dense `nameId` table —
//! the hash is only the host-facing / cross-bank identity.

const OFFSET_BASIS = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

const encoder = new TextEncoder();

/** FNV-1a 64 over the UTF-8 bytes of the NFC-normalised name. */
export function fnv1a64(name: string): bigint {
  let hash = OFFSET_BASIS;
  for (const byte of encoder.encode(name.normalize("NFC"))) {
    hash = ((hash ^ BigInt(byte)) * PRIME) & MASK;
  }
  return hash;
}

/** 16-char lowercase hex — JSON numbers cannot hold a u64 exactly. */
export function idHex(name: string): string {
  return fnv1a64(name).toString(16).padStart(16, "0");
}

/**
 * GDScript ints are *signed* 64-bit and a literal >= 2^63 is a parse
 * error, so its generated header emits signed decimals. Never print
 * these as unsigned.
 */
export function asSignedDecimal(hash: bigint): string {
  return (hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash).toString(10);
}

export interface IdCollision {
  hash: string;
  names: string[];
}

/**
 * Interns names into the dense table opcodes address, while watching for
 * the two failure modes worth catching at compile time: a genuine hash
 * collision (fatal — it would reroute a divert), and two names differing
 * only by case (a warning, because `SELF` resolution upper-cases ids at
 * runtime, so the pair can alias there).
 */
export class NameTable {
  private index = new Map<string, number>();
  private byHash = new Map<string, string>();
  private byFolded = new Map<string, string>();

  readonly names: string[] = [];
  readonly hashes: string[] = [];
  readonly collisions: IdCollision[] = [];
  readonly caseClashes: Array<[string, string]> = [];

  /** Intern `name`, returning its dense id. Idempotent. */
  intern(name: string): number {
    const existing = this.index.get(name);
    if (existing !== undefined) return existing;

    const hash = idHex(name);
    const clash = this.byHash.get(hash);
    if (clash !== undefined && clash !== name) {
      this.collisions.push({ hash, names: [clash, name] });
    }
    this.byHash.set(hash, name);

    // A case clash only matters when neither spelling is the other's
    // upper-cased form. `Wren` alongside `WREN` is Loom's own idiom — an
    // ALL-CAPS speaker cue naming a character — so flagging it would fire
    // on every project and teach authors to ignore the warning. `Wren`
    // alongside `wren` is a genuine aliasing hazard.
    const folded = name.toUpperCase();
    const cased = this.byFolded.get(folded);
    if (cased !== undefined && cased !== name && cased !== folded && name !== folded) {
      this.caseClashes.push([cased, name]);
    }
    if (cased === undefined || name !== folded) this.byFolded.set(folded, name);

    const id = this.names.length;
    this.names.push(name);
    this.hashes.push(hash);
    this.index.set(name, id);
    return id;
  }

  /** The dense id for an already-interned name, or `-1`. */
  lookup(name: string): number {
    return this.index.get(name) ?? -1;
  }

  hashOf(id: number): string {
    return this.hashes[id] ?? "0000000000000000";
  }

  nameOf(id: number): string {
    return this.names[id] ?? "";
  }
}
