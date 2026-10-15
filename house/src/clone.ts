//! A deep copy of plain JSON data (a house map, a wire payload) that works
//! on old tablets. `structuredClone` only arrived in Chrome 98, and the
//! show's oldest wall tablets run WebViews older than that (Android 7 tops
//! out at Chrome 119, but an un-updated System WebView can sit at 87). Where
//! it exists it is used as is; elsewhere a JSON round trip does the same job
//! for the data this package handles (no `Date`, `Map`, cycles or
//! `undefined` worth keeping).

type Cloner = <T>(value: T) => T;

const native: Cloner | null = typeof globalThis.structuredClone === "function" ? (v) => globalThis.structuredClone(v) : null;

/** JSON round trip — exported for tests; use `cloneData`. */
export function jsonClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** A deep copy of plain data: `structuredClone` when the runtime has it, else a JSON round trip. */
export function cloneData<T>(value: T): T {
  return native !== null ? native(value) : jsonClone(value);
}
