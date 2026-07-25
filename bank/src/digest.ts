//! Hashing + canonical JSON.
//!
//! Canonicalisation is normative: golden traces are diffed textually, so
//! key order, whitespace, and absent-vs-null all have to be pinned or the
//! diff is noise rather than signal.

import { createHash } from "node:crypto";
import { formatNumber } from "./value.ts";

export function sha256Hex(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * Serialise to canonical JSON: keys sorted lexicographically, no
 * whitespace, `undefined` members omitted entirely (never emitted as
 * `null`), and numbers formatted per the spec'd formatter.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    // JSON has no NaN or Infinity, so the non-finite values serialise as
    // their spec'd *string* spellings rather than becoming `null`.
    return Number.isFinite(value) ? formatNumber(value) : JSON.stringify(formatNumber(value));
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return "null";
}

/** SHA-256 of a value's canonical JSON — what a trace `digest` records. */
export function digestOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
