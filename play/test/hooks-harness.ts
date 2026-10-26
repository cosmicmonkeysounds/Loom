//! A tiny hooks harness for the node test runner (play has no DOM library).
//! It renders ONE function component (its own hooks, not its children)
//! through a fake React dispatcher and commits its effects the way React
//! 18 does — in particular, an effect's return value is its cleanup, and
//! React calls any cleanup that is not `undefined`. A string returned from
//! an effect therefore throws "… is not a function" on the next change or
//! on unmount, exactly as the live app did (wave 26 integration R1/P1).

import * as React from "react";

type Slot = { kind: string; value?: unknown; deps?: readonly unknown[] | undefined; create?: () => unknown; destroy?: unknown; pending?: boolean };
type Internals = { ReactCurrentDispatcher: { current: unknown } };
const internals = (React as unknown as { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: Internals }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/** React 18's `safelyCallDestroy` rule: anything but `undefined` is called. */
function destroy(s: Slot) {
  const d = s.destroy;
  s.destroy = undefined;
  if (d !== undefined) (d as () => void)();
}

export function mountHooks<P>(component: (props: P) => unknown, initialProps: P) {
  const slots: Slot[] = [];
  let i = 0;
  let props = initialProps;
  let dirty = false;
  let output: unknown = null;
  const slot = (kind: string): Slot => {
    const s = slots[i] ?? (slots[i] = { kind });
    i += 1;
    return s;
  };
  const effect = (kind: string) => (create: () => unknown, deps?: readonly unknown[]) => {
    const s = slot(kind);
    if (s.create === undefined || deps === undefined || !same(s.deps, deps)) {
      s.create = create;
      s.deps = deps;
      s.pending = true;
    }
  };
  const dispatcher = {
    useState: (init: unknown) => {
      const s = slot("state");
      if (!("value" in s)) s.value = typeof init === "function" ? (init as () => unknown)() : init;
      const set = (next: unknown) => {
        const v = typeof next === "function" ? (next as (p: unknown) => unknown)(s.value) : next;
        if (!Object.is(v, s.value)) {
          s.value = v;
          dirty = true;
        }
      };
      return [s.value, set];
    },
    useReducer: (r: (s: unknown, a: unknown) => unknown, init: unknown, fn?: (x: unknown) => unknown) => {
      const s = slot("reducer");
      if (!("value" in s)) s.value = fn ? fn(init) : init;
      return [s.value, (a: unknown) => { s.value = r(s.value, a); dirty = true; }];
    },
    useRef: (init: unknown) => {
      const s = slot("ref");
      if (!("value" in s)) s.value = { current: init };
      return s.value;
    },
    useMemo: (f: () => unknown, deps?: readonly unknown[]) => {
      const s = slot("memo");
      if (!("value" in s) || !same(s.deps, deps)) {
        s.value = f();
        s.deps = deps;
      }
      return s.value;
    },
    useCallback: (f: unknown, deps?: readonly unknown[]) => dispatcher.useMemo(() => f, deps),
    useContext: (c: { _currentValue: unknown }) => c._currentValue,
    useEffect: effect("effect"),
    useLayoutEffect: effect("layout"),
    useInsertionEffect: effect("insertion"),
    useImperativeHandle: () => {},
    useDebugValue: () => {},
    useId: () => `h${i}`,
    useTransition: () => [false, (f: () => void) => f()],
    useDeferredValue: (v: unknown) => v,
    useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
  };
  const render = () => {
    i = 0;
    const prev = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      output = component(props);
    } finally {
      internals.ReactCurrentDispatcher.current = prev;
    }
  };
  /** Commit: cleanups of the changed effects, then their creates (layout first). */
  const commit = () => {
    for (const kind of ["insertion", "layout", "effect"]) {
      const run = slots.filter((s) => s.kind === kind && s.pending === true);
      for (const s of run) destroy(s);
      for (const s of run) {
        s.pending = false;
        s.destroy = s.create!();
      }
    }
  };
  const settle = () => {
    for (let n = 0; n < 25; n += 1) {
      dirty = false;
      render();
      commit();
      if (!dirty) return;
    }
    throw new Error("hooks harness: the component never settled");
  };
  settle();
  return {
    get output() {
      return output;
    },
    /** Change state from outside (a setter captured from `output`) and re-render. */
    act(f: () => void) {
      f();
      if (dirty) settle();
    },
    rerender(next: P) {
      props = next;
      settle();
    },
    unmount() {
      for (const kind of ["insertion", "layout", "effect"]) for (const s of slots) if (s.kind === kind) destroy(s);
    },
  };
}

/** Every element in a rendered tree (no components are called). */
export function elements(node: unknown, out: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (React.isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: unknown }).children, out);
  }
  return out;
}
