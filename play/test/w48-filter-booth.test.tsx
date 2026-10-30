// Wave 48 (C5, docs/loom-w48-contract.md): the Password Manager's filter in
// the booth — `useFilter` (memory, ✂, refusals), the real pop-out driver
// over the real store, the pop-out's quote, the tray's `🔑 n`, the filter
// window (two taps to ✂), the layer's Back, and the guest's first load.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { elements, mountHooks } from "./hooks-harness.ts";
import { ARM_LINE } from "../src/arm.ts";
import { ApiError } from "../src/client.ts";
import { PlayHostContext, browserHost, memoryStore, type SessionStorage } from "../src/host.ts";
import { PopOut, PopOutScope, resetPopOutStores, usePopOuts, type PopOutsApi, type PopOutSpec } from "../src/booth/popouts/rung.ts";
import { bindDraft, useBoothPopOuts, type BoothOpeners, type DriverOpts } from "../src/booth/popouts/use-booth-popouts.ts";
import { parseStored, quoteText, storedOf, trayLine, EMPTY_POPOUTS, popReducer } from "../src/moments/popout-model.ts";
import { BoothTray, boothTrayOrder } from "../src/booth/tray.tsx";
import { closeTo } from "../src/booth/model.ts";
import { boothBackStep } from "../src/booth/app.tsx";
import { FILTER_COPY, filterDraft, filterStoreKey } from "../src/booth/filter/model.ts";
import { useFilter, type FilterApi, type FilterSource } from "../src/booth/filter/use-filter.ts";
import { FilterRow, FilterWindow, MarkedLine } from "../src/booth/filter/window.tsx";
import type { PrimeSession } from "../src/session/prime.ts";
import type { CensorResult, FilterLine, FilterView, PrimeView } from "../src/types.ts";

vi.mock("../src/alerts.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/alerts.ts")>()), playTone: vi.fn() }));

const TOKEN = "tok-w48";
const L = (seq: number, extra: Partial<FilterLine> = {}): FilterLine => ({
  seq,
  guest: `g-${seq}`,
  name: `Program ${seq}`,
  where: "# lobby",
  text: "my password is hello",
  hits: [
    { start: 4, end: 7 },
    { start: 15, end: 19 },
  ],
  words: ["password", "hello"],
  ts: seq * 1000,
  ...extra,
});
const FV = (lines: FilterLine[], extra: Partial<FilterView> = {}): FilterView => ({ flagged: lines.length * 2, censored: 0, lines, ...extra });
const PV = (filter?: FilterView): PrimeView => ({ character: "Password Manager", faction: null, guests: [], channels: [], spaces: [], interactions: [], objectives: [], player: true, ...(filter !== undefined ? { filter } : {}) }) as PrimeView;
const ok = (seq: number): CensorResult => ({ ok: true, seq, text: "my p***word is ****o" });
const noop = () => {};

/** `useFilter` under the hooks harness, with a view to swap. */
function filterRig(opts: { lines?: FilterLine[]; censor?: (seq: number) => Promise<CensorResult>; storage?: SessionStorage; token?: string } = {}) {
  const storage = opts.storage ?? memoryStore();
  let view = PV(FV(opts.lines ?? []));
  let token = opts.token ?? TOKEN;
  const src = (): FilterSource => ({ auth: { token }, view, ...(opts.censor !== undefined ? { censor: opts.censor } : {}) });
  const h = mountHooks((p: { s: FilterSource; storage: SessionStorage }) => useFilter(p.s, p.storage), { s: src(), storage });
  return {
    h,
    storage,
    get api() {
      return h.output as FilterApi;
    },
    setLines(lines: FilterLine[], extra: Partial<FilterView> = {}) {
      view = PV(FV(lines, extra));
      h.rerender({ s: src(), storage });
    },
    setView(v: PrimeView) {
      view = v;
      h.rerender({ s: src(), storage });
    },
    setToken(t: string) {
      token = t;
      h.rerender({ s: src(), storage });
    },
    get view() {
      return view;
    },
    /** Let the async setters land. */
    settle() {
      h.act(() => {});
    },
  };
}

describe("useFilter: this phone's memory, ✂ and refusals", () => {
  it("lists the waiting lines oldest first; Let it go hides one for good and saves it under loom.booth.filter.<token>", () => {
    const r = filterRig({ lines: [L(2), L(1)] });
    expect(r.api.waiting.map((l) => l.seq)).toEqual([1, 2]);
    r.h.act(() => r.api.letGo(1));
    expect(r.api.waiting.map((l) => l.seq)).toEqual([2]);
    expect(r.storage.load(filterStoreKey(TOKEN))).toEqual({ seen: [1], let: [1] });
    // A reload (a fresh mount on the same storage) keeps it let go.
    const again = filterRig({ lines: [L(1), L(2)], storage: r.storage });
    expect(again.api.waiting.map((l) => l.seq)).toEqual([2]);
    // Another sign-in on the same phone has its own memory.
    again.setToken("tok-other");
    expect(again.api.waiting.map((l) => l.seq)).toEqual([1, 2]);
  });

  it("markSeen persists the seen set; nothing changes when it is already known", () => {
    const r = filterRig({ lines: [L(1)] });
    r.h.act(() => r.api.markSeen([1]));
    expect(r.api.seen).toEqual([1]);
    expect(r.storage.load(filterStoreKey(TOKEN))).toEqual({ seen: [1], let: [] });
  });

  it("✂ answered 200: the line leaves at once, before the view catches up; then the drop is forgotten", async () => {
    const posted: number[] = [];
    const r = filterRig({ lines: [L(1), L(2)], censor: async (seq) => (posted.push(seq), ok(seq)) });
    expect(await r.api.censor(1)).toEqual({ kind: "done" });
    r.settle();
    expect(posted).toEqual([1]);
    expect(r.api.waiting.map((l) => l.seq)).toEqual([2]);
    r.setLines([L(2)], { censored: 2 });
    expect(r.api.waiting.map((l) => l.seq)).toEqual([2]);
    expect(r.api.view?.censored).toBe(2);
  });

  it("409 already censored drops it quietly; another refusal stays with the line, said in place, until the next try", async () => {
    let answer: unknown = new ApiError("already censored", 409);
    const r = filterRig({
      lines: [L(1), L(2)],
      censor: async () => {
        throw answer;
      },
    });
    expect(await r.api.censor(1)).toEqual({ kind: "gone" });
    r.settle();
    expect(r.api.waiting.map((l) => l.seq)).toEqual([2]);
    expect(r.api.refusal(1)).toBeNull();

    answer = new ApiError("doors are closed", 409);
    const before = r.api.key;
    expect(await r.api.censor(2)).toEqual({ kind: "refused", text: "Not censored: the doors are closed." });
    r.settle();
    expect(r.api.waiting.map((l) => l.seq)).toEqual([2]);
    expect(r.api.refusal(2)).toBe("Not censored: the doors are closed.");
    expect(r.api.key).not.toBe(before);

    answer = null;
    const r2 = filterRig({ lines: [L(2)], censor: async (seq) => ok(seq) });
    expect(r2.api.refusal(2)).toBeNull();
  });

  it("a session with no censor call (an old build's fake) refuses in place, never throws", async () => {
    const r = filterRig({ lines: [L(1)] });
    expect(await r.api.censor(1)).toEqual({ kind: "refused", text: FILTER_COPY.refused.offline });
  });

  it("not the censor (no PrimeView.filter): nothing waits", () => {
    const r = filterRig({ lines: [L(1)] });
    r.setView(PV());
    expect(r.api.view).toBeNull();
    expect(r.api.waiting).toEqual([]);
  });
});

describe("the booth's driver raises 🔑 LANGUAGE on the real store", () => {
  type Ctx = { _currentValue: unknown };
  const scopeCtx = ((mountHooks(PopOutScope, { session: null, children: null }).output as ReactElement).type as unknown as { _context: Ctx })._context;
  const hostCtx = PlayHostContext as unknown as Ctx;
  const held = () => (mountHooks(usePopOuts, undefined as never).output as PopOutsApi).held.map((e) => e.spec);
  const api = () => mountHooks(usePopOuts, undefined as never).output as PopOutsApi;
  let storage: SessionStorage;

  beforeEach(() => {
    resetPopOutStores();
    storage = memoryStore();
    scopeCtx._currentValue = { session: TOKEN };
    hostCtx._currentValue = { ...browserHost, storage, sound: true };
  });
  afterEach(() => {
    scopeCtx._currentValue = null;
    hostCtx._currentValue = browserHost;
  });

  function rig(lines: FilterLine[], censor?: (seq: number) => Promise<CensorResult>) {
    const f = filterRig({ lines, storage, ...(censor !== undefined ? { censor } : {}) });
    let filterOpen = false;
    const opened: string[] = [];
    const open: BoothOpeners = {
      act: async () => {},
      card: noop,
      scan: noop,
      board: noop,
      door: noop,
      pick: noop,
      cue: noop,
      censor: (seq) =>
        f.api.censor(seq).then((o) => {
          if (o.kind === "refused") throw new Error(o.text);
        }),
      letGo: (seq) => f.api.letGo(seq),
      filter: () => opened.push("filter"),
    };
    const session = () => ({ auth: { token: TOKEN, character: "Password Manager" }, view: f.view, messages: new Map(), card: () => new Promise(() => {}) }) as unknown as PrimeSession;
    const opts = (): DriverOpts => ({ session: session(), open, now: 1_000, placeTitle: () => null, ownFireAt: () => null, filter: f.api, filterOpen });
    const h = mountHooks(useBoothPopOuts, opts());
    /** One round: the filter hook takes what the driver remembered, the driver sees it. */
    const step = () => {
      for (let i = 0; i < 3; i++) {
        f.settle();
        h.rerender(opts());
      }
    };
    step();
    return {
      f,
      opened,
      step,
      lines(next: FilterLine[]) {
        f.setLines(next);
        step();
      },
      window(on: boolean) {
        filterOpen = on;
        step();
      },
    };
  }

  it("a new line pops once; lines that land while it is up only count (its button counts them)", () => {
    const r = rig([L(1)]);
    expect(held().map((s) => s.key)).toEqual(["filter:1"]);
    expect(storage.load(filterStoreKey(TOKEN))).toEqual({ seen: [1], let: [] });
    r.lines([L(1), L(2), L(3)]);
    expect(held().map((s) => s.key)).toEqual(["filter:1"]);
    expect(held()[0]!.actions.map((a) => a.label)).toEqual(["✂ Censor", "Let it go", "🔑 All flagged (3)"]);
    expect(storage.load<{ seen: number[] }>(filterStoreKey(TOKEN))!.seen).toEqual([1, 2, 3]);
  });

  it("Let it go on the pop-out: it retires, and the lines that came meanwhile never pop; a newer one does", async () => {
    const r = rig([L(1)]);
    r.lines([L(1), L(2)]);
    await held()[0]!.actions.find((a) => a.id === "let")!.run();
    r.step();
    expect(held()).toEqual([]);
    expect(r.f.api.waiting.map((l) => l.seq)).toEqual([2]);
    r.lines([L(1), L(2), L(3)]);
    expect(held().map((s) => s.key)).toEqual(["filter:3"]);
  });

  it("Later puts it in 🔔 Waiting; the next line still pops and takes its place", () => {
    const r = rig([L(1)]);
    api().defer("filter:1");
    expect(api().tray.map((s) => s.key)).toEqual(["filter:1"]);
    r.lines([L(1), L(2)]);
    expect(api().tray.map((s) => s.key)).toEqual([]);
    expect(held().map((s) => s.key)).toEqual(["filter:2"]);
  });

  it("✂ answered 200 retires it; a refusal keeps it up with the reason on its status line", async () => {
    let refuse = true;
    const r = rig([L(1), L(2)], async (seq) => {
      if (refuse) throw new ApiError("doors are closed", 409);
      return ok(seq);
    });
    const censor = () => held()[0]!.actions.find((a) => a.id === "censor")!;
    expect(censor().arm).toBe(true);
    await expect(censor().run()).rejects.toThrow("Not censored: the doors are closed.");
    r.step();
    expect(held().map((s) => s.key)).toEqual(["filter:2"]);
    expect(held()[0]!.status).toBe("Not censored: the doors are closed.");
    refuse = false;
    await censor().run();
    r.step();
    expect(held()).toEqual([]);
    expect(r.f.api.waiting.map((l) => l.seq)).toEqual([1]);
  });

  it("🔑 All flagged opens the window; with the window open every pop-out retires and new lines only count", () => {
    const r = rig([L(1)]);
    r.lines([L(1), L(2)]);
    void held()[0]!.actions.find((a) => a.id === "all")!.run();
    expect(r.opened).toEqual(["filter"]);
    r.window(true);
    expect(held()).toEqual([]);
    r.lines([L(1), L(2), L(3)]);
    expect(held()).toEqual([]);
    r.window(false);
    expect(held()).toEqual([]);
    r.lines([L(1), L(2), L(3), L(4)]);
    expect(held().map((s) => s.key)).toEqual(["filter:4"]);
  });

  it("a line the view drops (censored elsewhere, hidden by a director) retires its pop-out", () => {
    const r = rig([L(1)]);
    r.lines([]);
    expect(held()).toEqual([]);
  });

  it("a booth that is not the censor gets none", () => {
    const r = rig([]);
    r.f.setView(PV());
    r.step();
    expect(held()).toEqual([]);
  });
});

describe("the pop-out draws the line, its stems marked", () => {
  const fakeApi = { queued: 0, defer: noop, retire: noop } as unknown as PopOutsApi;
  const openers: BoothOpeners = { act: async () => {}, card: noop, scan: noop, board: noop, door: noop, pick: noop, cue: noop };

  it("🔑 LANGUAGE: the name, where, the quote with <mark>s, ✂ Censor, Let it go, 🔑 All flagged (n), Later, the hint", () => {
    const spec = bindDraft(filterDraft(L(4, { name: "Napster" }), 3), openers, noop);
    const html = renderToStaticMarkup(<PopOut entry={{ spec }} api={fakeApi} />);
    expect(html).toContain("🔑");
    expect(html).toContain("LANGUAGE");
    expect(html).toContain("Napster");
    expect(html).toContain("in # lobby");
    expect(html).toContain('<p class="popout-quote"><span>my p</span><mark class="popout-mark">ass</mark><span>word is </span><mark class="popout-mark">hell</mark><span>o</span></p>');
    expect(html).toContain("✂ Censor");
    expect(html).toContain("Let it go");
    expect(html).toContain("🔑 All flagged (3)");
    expect(html).toContain("Later");
    expect(html).toContain(FILTER_COPY.hint);
  });

  it("its buttons go to the booth: ✂ to censor, Let it go, 🔑 All flagged to the window", async () => {
    const calls: string[] = [];
    const spec = bindDraft(filterDraft(L(4), 3), { ...openers, censor: async (seq) => void calls.push(`censor ${seq}`), letGo: (seq) => void calls.push(`let ${seq}`), filter: () => void calls.push("window") }, noop);
    for (const a of spec.actions) await a.run();
    expect(calls).toEqual(["censor 4", "let 4", "window"]);
  });

  it("storage keeps the quote, and a 🔔 Waiting row reads it when the body is empty", () => {
    const spec: PopOutSpec = bindDraft(filterDraft(L(4), 1), openers, noop);
    const deferred = popReducer(popReducer(EMPTY_POPOUTS, { type: "raise", spec }), { type: "defer", key: spec.key, at: 0 });
    const back = parseStored(JSON.parse(JSON.stringify(storedOf(deferred))));
    expect(back.kept[0]!.spec.quote).toEqual(spec.quote);
    expect(trayLine(spec.body)).toBeNull();
    expect(trayLine(quoteText(back.kept[0]!.spec.quote))).toBe("my password is hello");
    expect(parseStored({ kept: [{ spec: { key: "k", title: "t", quote: [{ text: "a", mark: true }, { nope: 1 }, "x"] } }] }).kept[0]!.spec.quote).toEqual([{ text: "a", mark: true }]);
  });
});

describe("the tray's 🔑 n", () => {
  it("shows the count while lines wait (calm: no alarm tone), nothing at 0 or for another booth", () => {
    const html = renderToStaticMarkup(<BoothTray view={PV()} onWallet={noop} filter={3} windowed />);
    expect(html).toContain("🔑 3");
    expect(html).toContain('title="3 flagged lines to judge"');
    expect(html).not.toMatch(/tray-item alarm[^>]*title="3 flagged/u);
    expect(renderToStaticMarkup(<BoothTray view={PV()} onWallet={noop} filter={0} windowed />)).not.toContain("🔑");
    expect(renderToStaticMarkup(<BoothTray view={PV()} onWallet={noop} filter={null} />)).not.toContain("🔑");
    expect(renderToStaticMarkup(<BoothTray view={PV()} onWallet={noop} filter={1} />)).toContain('title="1 flagged line to judge"');
  });

  it("windowed order: 🔔 → 🚨 → 🔑 → the rest, the clock last", () => {
    const all = { waiting: true, loose: true, filter: true, held: true, soon: true, stat: true, act: true, clock: true };
    expect(boothTrayOrder(all)).toEqual(["waiting", "loose", "filter", "held", "countdown", "stat", "act", "clock"]);
    // A player censor on a 390 px phone (two shown): 🔑 beats the ⭐ score.
    expect(boothTrayOrder({ ...all, waiting: false, loose: false, held: false, soon: false }).slice(0, 2)).toEqual(["filter", "stat"]);
  });
});

describe("the filter window", () => {
  const lines = [L(1, { name: "Napster", ts: 0 }), L(2, { name: "Winamp", where: "DM to Trabolta", ts: 120_000 })];
  const api = (over: Partial<FilterApi> = {}): FilterApi =>
    ({ view: FV(lines, { flagged: 4, censored: 1 }), waiting: lines, censor: async () => ({ kind: "done" }), letGo: noop, refusal: () => null, ...over }) as FilterApi;

  it("Censored c of f flagged words, then every line oldest first with its stems marked, ✂ Censor and Let it go", () => {
    const html = renderToStaticMarkup(<FilterWindow api={api()} now={180_000} onClose={noop} />);
    expect(html).toContain("Language (2)");
    expect(html).toContain("Censored 1 of 4 flagged words");
    expect(html.indexOf("Napster")).toBeLessThan(html.indexOf("Winamp"));
    expect(html).toContain("in # lobby · 3 min ago");
    expect(html).toContain("DM to Trabolta · 1 min ago");
    expect(html).toContain('<mark class="filter-hit">ass</mark>');
    expect(html.match(/class="w95-btn filter-btn censor"[^>]*>✂ Censor</gu)?.length).toBe(2);
    expect(html.match(/class="w95-btn filter-btn"[^>]*>Let it go</gu)?.length).toBe(2);
    expect(html).toContain(FILTER_COPY.foot);
  });

  it("empty: Nothing to judge.", () => {
    const html = renderToStaticMarkup(<FilterWindow api={api({ waiting: [], view: FV([], { flagged: 6, censored: 6 }) })} now={0} onClose={noop} />);
    expect(html).toContain("Nothing to judge.");
    expect(html).toContain("Censored 6 of 6 flagged words");
    expect(html).not.toContain("filter-row");
  });

  it("a refusal is said under its line; a busy ✂ reads …", () => {
    const html = renderToStaticMarkup(<FilterRow line={L(1)} now={0} armed={false} busy refusal="Not censored: the doors are closed." onCensor={noop} onLetGo={noop} />);
    expect(html).toContain('<p class="filter-refused" role="status">Not censored: the doors are closed.</p>');
    expect(html).toContain(">…<");
    expect(renderToStaticMarkup(<MarkedLine text="hello" hits={[{ start: 0, end: 4 }]} />)).toBe('<p class="filter-line"><mark class="filter-hit">hell</mark><span>o</span></p>');
  });

  it("✂ takes two taps (the first arms: Tap again to fire); Let it go takes one", async () => {
    vi.useFakeTimers({ now: 50_000 });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: noop, removeEventListener: noop });
    vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop });
    try {
      const censored: number[] = [];
      const letGone: number[] = [];
      let release: () => void = noop;
      const props = { api: api({ censor: (seq) => (censored.push(seq), new Promise((res) => (release = () => res({ kind: "done" })))), letGo: (seq) => void letGone.push(seq) }), now: 0, onClose: noop };
      const h = mountHooks(FilterWindow, props);
      const rows = () => elements(h.output).filter((e) => e.type === FilterRow) as Array<ReactElement<Parameters<typeof FilterRow>[0]>>;
      expect(rows().map((r) => r.props.line.seq)).toEqual([1, 2]);
      h.act(() => rows()[0]!.props.onCensor());
      expect(censored).toEqual([]);
      expect(rows()[0]!.props.armed).toBe(true);
      vi.advanceTimersByTime(500);
      h.act(() => rows()[0]!.props.onCensor());
      expect(censored).toEqual([1]);
      expect(rows()[0]!.props.busy).toBe(true);
      expect(rows()[0]!.props.armed).toBe(false);
      release();
      await vi.runAllTimersAsync();
      h.act(noop);
      expect(rows()[0]!.props.busy).toBe(false);
      h.act(() => rows()[1]!.props.onLetGo());
      expect(letGone).toEqual([2]);
      // The armed row reads the arm line.
      h.act(() => rows()[1]!.props.onCensor());
      expect(renderToStaticMarkup(<FilterRow {...rows()[1]!.props} />)).toContain(ARM_LINE);
      h.unmount();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("is a booth layer: ×, Escape and Back close it to the booth", () => {
    expect(closeTo({ kind: "filter" })).toBeNull();
    expect(boothBackStep({ layer: { kind: "filter" }, sheet: null, people: null, help: false })).toBe("layer");
  });
});

describe("booth chunk only (the 149 kB gate) and the copy", () => {
  const SRC = new URL("../src/", import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/u.test(n) ? [p] : [];
    });

  it("nothing outside booth/ imports booth/filter; the booth app does", () => {
    for (const f of files(SRC)) {
      const rel = f.slice(SRC.length);
      if (rel.startsWith("booth/")) continue;
      expect(readFileSync(f, "utf8"), rel).not.toMatch(/from "[^"]*booth\/filter\//u);
    }
    const app = readFileSync(join(SRC, "booth/app.tsx"), "utf8");
    expect(app).toContain('from "./filter/use-filter.ts"');
    expect(app).toContain('from "./filter/window.tsx"');
  });

  it("the filter's copy is marked DRAFT w48 where it lives", () => {
    expect(readFileSync(join(SRC, "booth/filter/model.ts"), "utf8")).toContain("DRAFT w48");
    expect(readFileSync(join(SRC, "booth/filter/window.tsx"), "utf8")).toContain("DRAFT w48");
  });
});
