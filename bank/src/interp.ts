//! The reference interpreter — **the normative definition of bank
//! semantics.** Every per-engine runtime is conformance-tested against
//! this, so a behaviour that is not implemented here is not part of the
//! format, however clearly the spec prose reads.
//!
//! Deliberately written in a portable style — flat loops over integer
//! arrays, an explicit value stack, no closures over VM state — because
//! it doubles as the model a GDScript / C# / C++ implementation is
//! transliterated from.

import { World } from "@loom/core/runtime";
import type { Value } from "@loom/core/runtime";
import { idHex } from "./ids.ts";
import {
  EOP_ARITY,
  EOp,
  HostMode,
  OP_NAMES,
  Op,
} from "./ir.ts";
import type { Bank, BankValue, LocaleBank, Step } from "./ir.ts";
import { hex64, parseHex64, shufflePick, shuffleSeed, xorshift64Next } from "./prng.ts";
import {
  VNULL,
  applyBinary,
  asNumber,
  displaySpec,
  fromBankValue,
  toBankValue,
  truthy,
  valuesEqual,
  vBool,
  vList,
  vNumber,
  vString,
} from "./value.ts";

/** Cap on hook-drain cycles, mirroring the live engine's backstop. */
const DRAIN_LIMIT = 10_000;

interface Frame {
  program: number;
  pc: number;
  locals: Array<Value | undefined>;
  bindings: Map<string, string>;
  setting: number;
  cast: number;
  tunnelAnchor: boolean;
  subject: string;
}

interface Trigger {
  verb: string;
  subject: string;
  filter: string;
}

interface PendingMenu {
  program: number;
  menu: number;
  subject: string;
  /** Option indices still offered, after once-only filtering. */
  visible: number[];
}

export interface LoadResult {
  ok: boolean;
  reason?: string;
}

export interface SaveState {
  loomSave: number;
  banks: Array<{ id: string; sourceHash: string }>;
  locale: string;
  elapsedMs: number;
  world: Record<string, BankValue>;
  frames: Array<{
    program: string;
    pc: number;
    locals: Array<BankValue | null>;
    bindings: Array<[string, string]>;
    setting: number;
    cast: number;
    tunnelAnchor: boolean;
    subject: string;
  }>;
  pendingMenu: { program: string; menu: number; subject: string; visible: number[] } | null;
  counters: Array<[string, number]>;
  latches: string[];
  taken: string[];
  programQueue: Array<{ program: string; bindings: Array<[string, string]> }>;
  triggers: Trigger[];
  timers: Array<[string, number]>;
  timerFired: string[];
  /** Per-site `<shuffle:>` PRNG states, as 16-char hex (prng.ts). */
  shuffles: Array<[string, string]>;
}

/**
 * A bank VM. One instance is one narrative thread: a menu suspends the
 * whole machine. A multi-participant host runs one VM per participant
 * over a shared world — see the spec's §3.2.
 */
export class BankVM {
  readonly world = new World();
  private banks: Bank[] = [];
  private frames: Frame[] = [];
  private counters = new Map<string, number>();
  private latches = new Set<string>();
  private taken = new Set<string>();
  private pendingMenu: PendingMenu | null = null;
  private triggers: Trigger[] = [];
  private programQueue: Array<{ program: number; bindings: Map<string, string> }> = [];
  private timers = new Map<string, number>();
  private timerFired = new Set<string>();
  private shuffles = new Map<string, bigint>();
  private localeBanks: LocaleBank[] = [];
  private elapsedMs = 0;
  private locale = "";
  private diagnostics: string[] = [];
  /** name → dense id, so speaker/beat lookups are not linear scans. */
  private nameIds = new Map<string, number>();
  private programsByName = new Map<string, number>();

  /** Host-supplied expression functions, consulted before returning null. */
  hostCall: ((name: string, args: Value[]) => Value | null) | null = null;

  // -------------------------------------------------------------------
  // Banks
  // -------------------------------------------------------------------

  loadBank(bank: Bank | LocaleBank): boolean {
    if (bank.kind === "locale") {
      // A locale bank is a resource, not story state: text overrides plus
      // its own string table, activated by `setLocale`.
      this.localeBanks.push(bank);
      return true;
    }
    this.banks.push(bank);
    bank.names.forEach((name, id) => {
      if (!this.nameIds.has(name)) this.nameIds.set(name, id);
    });
    bank.programs.forEach((p, i) => this.programsByName.set(bank.names[p.name] ?? "", i));
    for (const [path, value] of Object.entries(bank.globals)) {
      if (this.world.peek(path) === null) this.world.set(path, fromBankValue(value));
    }
    for (const entity of bank.entities.tables) {
      const id = bank.names[entity.id] ?? "";
      for (const [field, value] of Object.entries(entity.fields)) {
        const path = `${id}.${field}`;
        if (this.world.peek(path) === null) this.world.set(path, fromBankValue(value));
      }
    }
    return true;
  }

  setLocale(tag: string): void {
    this.locale = tag;
  }

  /** The only bank in a single-bank build; multi-bank lands with splitting. */
  private get bank(): Bank {
    return this.banks[0]!;
  }

  // -------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------

  /** Program index for a beat name, or -1. */
  programByName(name: string): number {
    return this.programsByName.get(name) ?? -1;
  }

  start(program: number, bindings: Map<string, string> = new Map()): void {
    this.frames = [];
    this.pendingMenu = null;
    this.programQueue = [];
    this.triggers = [];
    if (program < 0 || program >= this.bank.programs.length) return;
    this.programQueue.push({ program, bindings });
  }

  isWaiting(): boolean {
    return this.pendingMenu !== null;
  }

  /**
   * One step of progress. The algorithm is normative (spec §7.2): a
   * pending menu blocks; otherwise run frames, then the program queue,
   * then drain one trigger, then report `done`.
   */
  advance(): Step {
    if (this.pendingMenu !== null) return { step: "idle" };

    for (let guard = 0; guard < DRAIN_LIMIT; guard++) {
      if (this.frames.length > 0) {
        const step = this.runFrames();
        if (step !== null) return step;
        continue;
      }
      const queued = this.programQueue.shift();
      if (queued !== undefined) {
        const step = this.enterProgram(queued.program, queued.bindings);
        if (step !== null) return step;
        continue;
      }
      const trigger = this.triggers.shift();
      if (trigger !== undefined) {
        this.matchHooks(trigger);
        continue;
      }
      return { step: "done" };
    }
    return { step: "error", code: "drainOverflow", message: "hook drain did not settle" };
  }

  /** Advance until a choice, idle, or done — the `run` driver command. */
  run(limit = 100_000): Step[] {
    const out: Step[] = [];
    for (let i = 0; i < limit; i++) {
      const step = this.advance();
      out.push(step);
      if (step.step === "choice" || step.step === "done" || step.step === "idle") break;
      if (step.step === "error") break;
    }
    return out;
  }

  choose(index: number): boolean {
    const pending = this.pendingMenu;
    if (pending === null) return false;
    const optionIndex = pending.visible[index];
    if (optionIndex === undefined) return false;

    const bank = this.bank;
    const menu = bank.menus[pending.menu];
    const option = menu?.options[optionIndex];
    if (menu === undefined || option === undefined) return false;

    this.pendingMenu = null;
    // Record every taken option, sticky or not: `sticky` controls whether
    // it is still *offered* on a revisit, while `suppressed` needs to know
    // it was taken either way in order to render its after-text.
    this.taken.add(this.subjectKey(option.tag, pending.subject));

    const frame = this.frames[this.frames.length - 1];
    if (frame === undefined) return false;
    frame.pc = option.target;
    return true;
  }

  /**
   * Push a frame for `program`. Returns the `BeatEnter` step, or `null`
   * for a hook body — hooks are internal plumbing, so a host sees the
   * lines and writes they produce but not the dispatch itself.
   */
  private enterProgram(program: number, callerBindings: Map<string, string>): Step | null {
    const bank = this.bank;
    const p = bank.programs[program]!;
    const name = bank.names[p.name] ?? "";

    // A class-owned beat is owned by definition, so its `self` is its
    // owner whichever way it was reached — a compile-time-resolved
    // `-> Wren.greet`, a dynamic `-> self.greet`, or a direct `start`.
    // Without this a `SELF` cue in an owned beat would fall all the way
    // through to the literal token.
    let bindings = callerBindings;
    if (p.kind === "ownedBeat") {
      const owner = name.slice(0, name.indexOf("."));
      if (owner.length > 0 && bindings.get("self") !== owner) {
        bindings = new Map(bindings);
        bindings.set("self", owner);
      }
    }

    const subject = bindings.get("guest") ?? bindings.get("self") ?? "";
    const caller = this.frames[this.frames.length - 1];
    const setting = p.setting >= 0 ? p.setting : (caller?.setting ?? -1);

    this.bumpCounter(`v:${p.hash}`, subject);
    this.frames.push({
      program,
      pc: 0,
      locals: new Array(p.localCount).fill(undefined),
      bindings,
      setting,
      cast: p.cast,
      tunnelAnchor: false,
      subject,
    });
    if (p.kind === "hook") return null;
    return {
      step: "beat",
      program: p.hash,
      name,
      setting: setting >= 0 ? bank.nameHashes[setting]! : "",
      subject,
    };
  }

  /** Run instructions until one yields a Step, or the stack empties. */
  private runFrames(): Step | null {
    const bank = this.bank;
    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1]!;
      const program = bank.programs[frame.program]!;
      const base = frame.pc * 4;
      if (base >= program.code.length) {
        this.frames.pop();
        continue;
      }
      const op = program.code[base]!;
      const a = program.code[base + 1]!;
      const b = program.code[base + 2]!;
      const c = program.code[base + 3]!;
      frame.pc += 1;

      switch (op) {
        case Op.Nop:
          break;

        case Op.Narrate:
          return {
            step: "line",
            speaker: 0,
            text: this.renderText(a, frame),
            setting: frame.setting >= 0 ? bank.nameHashes[frame.setting]! : undefined,
            note: this.noteAt(program, frame.pc - 1),
          };

        case Op.Speak: {
          const speaker = bank.speakers[a];
          if (speaker === undefined) break;
          const resolved = this.resolveSpeaker(speaker, frame);
          return {
            step: "line",
            speaker: resolved.hash,
            display: resolved.display,
            text: this.renderText(b, frame),
            setting: frame.setting >= 0 ? bank.nameHashes[frame.setting]! : undefined,
            note: this.noteAt(program, frame.pc - 1),
          };
        }

        case Op.Jump:
          frame.pc = a;
          break;

        case Op.JumpIfNot:
          if (!truthy(this.evalExpr(a, frame))) frame.pc = b;
          break;

        case Op.Match: {
          const scrutinee = this.evalExpr(a, frame);
          const table = bank.switches[b];
          if (table === undefined) break;
          let target = table.default;
          for (const arm of table.cases) {
            const lit = fromBankValue(arm.lit);
            const hit =
              bank.matchMode === "display"
                ? displaySpec(lit) === displaySpec(scrutinee)
                : valuesEqual(lit, scrutinee);
            if (hit) {
              target = arm.target;
              break;
            }
          }
          if (target >= 0) frame.pc = target;
          break;
        }

        case Op.Menu: {
          const menu = bank.menus[a];
          if (menu === undefined) break;
          // Once-only options drop out on a revisit, and a guard hides an
          // option outright. An exhausted menu is never a dead end: it
          // reports `idle` once and continues at `resume`.
          const visible: number[] = [];
          menu.options.forEach((option, i) => {
            if (!option.sticky && this.taken.has(this.subjectKey(option.tag, frame.subject))) return;
            if (option.cond >= 0 && !truthy(this.evalExpr(option.cond, frame))) return;
            visible.push(i);
          });
          if (visible.length === 0) {
            frame.pc = menu.resume;
            return { step: "idle" };
          }
          this.pendingMenu = { program: frame.program, menu: a, subject: frame.subject, visible };
          // The frame's cursor stays at the menu's resume point; `choose`
          // redirects it into the option body.
          frame.pc = menu.resume;
          return {
            step: "choice",
            menu: `${program.hash}:${a}`,
            options: visible.map((optionIndex, i) => {
              const option = menu.options[optionIndex]!;
              const taken = this.taken.has(this.subjectKey(option.tag, frame.subject));
              const textId = taken && option.suppressed >= 0 ? option.suppressed : option.text;
              return { i, text: this.renderText(textId, frame), tag: option.tag };
            }),
          };
        }

        case Op.EachVisit: {
          const table = bank.visitTables[b];
          if (table === undefined) break;
          const key = program.siteKeys[a] ?? `${program.hash}#${a}`;
          const n = this.bumpCounter(key, frame.subject);
          if (table.branches.length === 0) {
            frame.pc = table.resume;
            break;
          }
          // Clamp to the last authored branch, so `finally` sticks.
          const pick = Math.min(n, table.branches.length) - 1;
          frame.pc = table.branches[pick]!;
          break;
        }

        case Op.Shuffle: {
          const table = bank.visitTables[b];
          if (table === undefined) break;
          if (table.branches.length === 0) {
            frame.pc = table.resume;
            break;
          }
          const siteKey = program.siteKeys[a] ?? `${program.hash}#${a}`;
          const key = this.subjectKey(siteKey, frame.subject);
          const prior = this.shuffles.get(key) ?? shuffleSeed(parseHex64(bank.seed), siteKey);
          const state = xorshift64Next(prior);
          this.shuffles.set(key, state);
          frame.pc = table.branches[shufflePick(state, table.branches.length)]!;
          break;
        }

        case Op.After: {
          const key = this.subjectKey(program.siteKeys[a] ?? `${program.hash}#${a}`, frame.subject);
          if (this.latches.has(key) || truthy(this.evalExpr(b, frame))) {
            // Latch permanently, as the writer's guide promises — the
            // live engine re-evaluates every pass instead.
            this.latches.add(key);
          } else {
            frame.pc = c;
          }
          break;
        }

        case Op.Let:
          frame.locals[a] = this.evalExpr(b, frame);
          break;

        case Op.ClearLocals:
          for (let i = 0; i < b; i++) frame.locals[a + i] = undefined;
          break;

        case Op.Set: {
          const entry = bank.sets[a];
          if (entry === undefined) break;
          const path = this.expandPath(entry.path, frame);
          let next = this.evalExpr(entry.expr, frame);
          // A bare-identifier right-hand side doubles as a string when it
          // resolves to nothing: `<set: g.faction = Mods>`.
          if (next.kind === "null" && entry.enum >= 0) {
            next = vString(bank.strings[entry.enum] ?? "");
          }
          if (entry.op !== "=") {
            const current = asNumber(this.world.get(path)) ?? 0;
            const operand = asNumber(next) ?? 0;
            const result =
              entry.op === "+="
                ? current + operand
                : entry.op === "-="
                  ? current - operand
                  : entry.op === "*="
                    ? current * operand
                    : current / operand;
            next = vNumber(result);
          }
          this.world.set(path, next);
          return { step: "varset", path, value: toBankValue(next) };
        }

        case Op.Signal: {
          const verb = bank.names[a] ?? "";
          this.triggers.push({ verb, subject: "", filter: "" });
          return { step: "signal", verb: bank.nameHashes[a] ?? "", subject: "" };
        }

        case Op.Host: {
          const verbName = bank.names[a] ?? "";
          const args = b >= 0 ? bank.directiveArgs[b] : undefined;
          const named: Record<string, string> = {};
          for (const pair of args?.named ?? []) {
            named[bank.names[pair.key] ?? ""] = this.renderText(pair.text, frame);
          }
          return {
            step: "directive",
            verb: bank.nameHashes[a] ?? "",
            verbName,
            positional: (args?.positional ?? []).map((t) => this.renderText(t, frame)),
            named,
            raw: args !== undefined ? this.renderText(args.raw, frame) : "",
            block: c === -1 ? HostMode.Leaf : (c as HostMode),
          };
        }

        case Op.Divert:
        case Op.Tunnel: {
          const resolved = this.resolveTarget(a, frame);
          if (resolved === null) {
            return {
              step: "error",
              code: "unresolvedTarget",
              message: `divert target ${a} did not resolve`,
            };
          }
          const bindings = this.bindingsFor(b, frame, resolved.rebindSelf);
          if (op === Op.Tunnel) frame.tunnelAnchor = true;
          const entered = this.enterProgram(resolved.program, bindings);
          if (entered !== null) return entered;
          break;
        }

        case Op.Return: {
          // `TUNNEL` flags the *calling* frame, so unwind until the frame
          // below the one we popped is that caller, then resume it. With
          // no anchor anywhere, `<-` behaves as `END`.
          let found = false;
          while (this.frames.length > 0) {
            this.frames.pop();
            const parent = this.frames[this.frames.length - 1];
            if (parent !== undefined && parent.tunnelAnchor) {
              parent.tunnelAnchor = false;
              found = true;
              break;
            }
          }
          if (!found) this.frames = [];
          break;
        }

        case Op.End:
          this.frames = [];
          return null;

        case Op.Halt:
          this.frames.pop();
          break;

        case Op.CallSlot:
          this.diagnostics.push(`${OP_NAMES[op]} is reserved and not executed in v1`);
          break;

        default:
          return { step: "error", code: "badOpcode", message: `opcode ${op}` };
      }
    }
    return null;
  }

  // -------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------

  signal(verb: string, subject = "", filter = ""): void {
    this.triggers.push({ verb, subject, filter });
  }

  private matchHooks(trigger: Trigger): void {
    const bank = this.bank;
    // Bank order is frozen at compile time, because map iteration order is
    // not portable across three runtimes.
    for (const hook of [...bank.hooks].sort((x, y) => x.order - y.order)) {
      if ((bank.names[hook.verb] ?? "") !== trigger.verb) continue;
      // `on join Mods` only fires for the faction it names.
      if (hook.filter >= 0 && (bank.names[hook.filter] ?? "") !== trigger.filter) continue;
      const bindings = new Map<string, string>();
      bindings.set("self", bank.names[hook.owner] ?? "");
      if (hook.param >= 0 && trigger.subject.length > 0) {
        bindings.set(bank.names[hook.param] ?? "", trigger.subject);
      }
      this.programQueue.push({ program: hook.program, bindings });
    }
  }

  tick(dtMs: number): void {
    this.elapsedMs += dtMs;
    this.world.set("Time.elapsed", vNumber(this.elapsedMs));
    this.world.set("Time.minute", vNumber(Math.floor(this.elapsedMs / 60_000)));
    const bank = this.bank;
    for (const hook of bank.hooks) {
      if (hook.timer === null) continue;
      const key = `${hook.owner}:${hook.verb}:${hook.program}`;
      // A one-shot `after` records that it fired in VM state rather than
      // nulling the bank's own timer — the bank is shared, immutable data.
      if (hook.timer.mode === "after" && this.timerFired.has(key)) continue;
      const due = (this.timers.get(key) ?? 0) + hook.timer.ms;
      if (this.elapsedMs < due) continue;
      this.timers.set(key, this.elapsedMs);
      if (hook.timer.mode === "after") this.timerFired.add(key);
      this.programQueue.push({
        program: hook.program,
        bindings: new Map([["self", bank.names[hook.owner] ?? ""]]),
      });
    }
  }

  // -------------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------------

  /**
   * Walk one RPN window. Written as a flat loop over an int array with an
   * explicit stack precisely so it transliterates to GDScript / C# / C++
   * without restructuring.
   */
  private evalExpr(exprId: number, frame: Frame): Value {
    const ref = this.bank.exprs[exprId];
    if (ref === undefined) return VNULL;
    return this.evalRange(ref.at, ref.len, frame);
  }

  /** Evaluate an arbitrary window of `exprCode` — comprehensions use this. */
  private evalRange(at: number, len: number, frame: Frame): Value {
    const bank = this.bank;
    const stack: Value[] = [];
    const end = at + len;
    let ip = at;

    while (ip < end) {
      const op = bank.exprCode[ip]!;
      ip += 1;
      switch (op) {
        case EOp.Null:
          stack.push(VNULL);
          break;
        case EOp.True:
          stack.push(vBool(true));
          break;
        case EOp.False:
          stack.push(vBool(false));
          break;
        case EOp.Num:
          stack.push(vNumber(bank.exprConsts.nums[bank.exprCode[ip]!] ?? 0));
          ip += 1;
          break;
        case EOp.Str:
          stack.push(vString(bank.strings[bank.exprCode[ip]!] ?? ""));
          ip += 1;
          break;
        case EOp.Path:
          stack.push(this.world.get(this.expandPath(bank.exprCode[ip]!, frame)));
          ip += 1;
          break;
        case EOp.Local:
          stack.push(frame.locals[bank.exprCode[ip]!] ?? VNULL);
          ip += 1;
          break;
        case EOp.List: {
          const n = bank.exprCode[ip]!;
          ip += 1;
          const items = stack.splice(stack.length - n, n);
          stack.push(vList(items));
          break;
        }
        case EOp.Neg:
          stack.push(vNumber(-(asNumber(stack.pop() ?? VNULL) ?? 0)));
          break;
        case EOp.Not:
          stack.push(vBool(!truthy(stack.pop() ?? VNULL)));
          break;
        case EOp.Add:
        case EOp.Sub:
        case EOp.Mul:
        case EOp.Div:
        case EOp.Mod:
        case EOp.Eq:
        case EOp.Ne:
        case EOp.Lt:
        case EOp.Le:
        case EOp.Gt:
        case EOp.Ge: {
          const right = stack.pop() ?? VNULL;
          const left = stack.pop() ?? VNULL;
          stack.push(applyBinary(op, left, right));
          break;
        }
        case EOp.JumpFalsePop: {
          const rel = bank.exprCode[ip]!;
          ip += 1;
          const top = stack[stack.length - 1] ?? VNULL;
          if (!truthy(top)) {
            stack[stack.length - 1] = vBool(false);
            ip += rel;
          } else {
            stack.pop();
          }
          break;
        }
        case EOp.JumpTruePop: {
          const rel = bank.exprCode[ip]!;
          ip += 1;
          const top = stack[stack.length - 1] ?? VNULL;
          if (truthy(top)) {
            stack[stack.length - 1] = vBool(true);
            ip += rel;
          } else {
            stack.pop();
          }
          break;
        }
        case EOp.ToBool:
          stack.push(vBool(truthy(stack.pop() ?? VNULL)));
          break;
        case EOp.Call: {
          const name = bank.names[bank.exprCode[ip]!] ?? "";
          const argc = bank.exprCode[ip + 1]!;
          ip += 2;
          const args = stack.splice(stack.length - argc, argc);
          stack.push(this.callBuiltin(name, args, frame));
          break;
        }
        case EOp.Comprehension: {
          const slot = bank.exprCode[ip]!;
          const vLen = bank.exprCode[ip + 1]!;
          const fLen = bank.exprCode[ip + 2]!;
          ip += 3;
          // The value and filter sub-programs follow inline.
          const vAt = ip;
          const fAt = ip + vLen;
          const source = stack.pop() ?? VNULL;
          const items = source.kind === "list" ? source.items : [];
          const out: Value[] = [];
          const saved = frame.locals[slot];
          for (const item of items) {
            frame.locals[slot] = item;
            if (fLen > 0 && !truthy(this.evalRange(fAt, fLen, frame))) continue;
            out.push(this.evalRange(vAt, vLen, frame));
          }
          frame.locals[slot] = saved;
          stack.push(vList(out));
          ip = vAt + vLen + fLen;
          break;
        }
        default:
          // Unknown e-op: skip its operands and yield null rather than
          // aborting, matching the engine's "an expression never throws".
          ip += EOP_ARITY[op] ?? 0;
          stack.push(VNULL);
          break;
      }
    }
    return stack.pop() ?? VNULL;
  }

  private callBuiltin(name: string, args: Value[], frame: Frame): Value {
    switch (name) {
      case "count": {
        const first = args[0];
        return vNumber(first !== undefined && first.kind === "list" ? first.items.length : 0);
      }
      case "visits": {
        const beat = args[0] !== undefined ? displaySpec(args[0]) : "";
        return vNumber(this.visitsOf(beat, frame.subject));
      }
      default: {
        // An unknown call is null, never an error — scripts lean on this.
        const hosted = this.hostCall?.(name, args);
        return hosted ?? VNULL;
      }
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  /** Bindings substitute per path segment, so `self.trust` → `Wren.trust`. */
  private expandPath(pathId: number, frame: Frame): string {
    const path = this.bank.paths[pathId];
    if (path === undefined) return "";
    return path.segs
      .map((seg) => {
        const name = this.bank.names[seg] ?? "";
        return frame.bindings.get(name) ?? name;
      })
      .join(".");
  }

  private renderText(textId: number, frame: Frame): string {
    const entry = this.bank.texts[textId];
    if (entry === undefined) return "";

    // Locale override: literal parts resolve against the *locale bank's*
    // string table, expressions against the content bank as ever.
    // Unmatched keys fall back to the source.
    if (this.locale !== "" && entry.loc !== undefined) {
      for (const localeBank of this.localeBanks) {
        if (localeBank.locale !== this.locale) continue;
        const override = localeBank.texts[entry.loc];
        if (override === undefined) continue;
        let out = "";
        for (const part of override.parts) {
          out +=
            part.k === "lit"
              ? (localeBank.strings[part.s] ?? "")
              : displaySpec(this.evalExpr(part.e, frame));
        }
        return out;
      }
    }

    let out = "";
    for (const part of entry.parts) {
      out += part.k === "lit" ? (this.bank.strings[part.s] ?? "") : displaySpec(this.evalExpr(part.e, frame));
    }
    return out;
  }

  private noteAt(program: Bank["programs"][number], pc: number): string | undefined {
    return program.notes.find((n) => n.pc === pc)?.text;
  }

  private resolveSpeaker(
    speaker: Bank["speakers"][number],
    frame: Frame,
  ): { hash: string; display: string } {
    if (speaker.mode === "lit") {
      const id = speaker.ids[0] ?? -1;
      return {
        hash: id >= 0 ? (this.bank.nameHashes[id] ?? "") : "",
        display: this.bank.names[speaker.display] ?? "",
      };
    }
    // `SELF`/`ME`: whoever routed in, else the beat's first cast member,
    // else the literal token — matching the live engine exactly.
    const self = frame.bindings.get("self");
    const name =
      self !== undefined && self.length > 0 ? self : (this.bank.names[frame.cast] ?? "SELF");
    // The live engine yields the *upper-cased* id, so a `SELF` line and an
    // explicit `WREN` cue are the same speaker. Hash the display form for
    // the same reason — otherwise a host keying on the speaker id would
    // see `Wren` and `WREN` as two different characters.
    const display = name.toUpperCase();
    return { hash: idHex(display), display };
  }

  private resolveTarget(
    targetId: number,
    frame: Frame,
  ): { program: number; rebindSelf: string | null } | null {
    const target = this.bank.targets[targetId];
    if (target === undefined) return null;
    if (target.kind === "local") return { program: target.program, rebindSelf: null };
    if (target.kind === "extern") return null;

    const name = this.bank.names[target.name] ?? "";
    const owner =
      target.qualifier === "self" ? frame.bindings.get("self") : (target.qualifier ?? undefined);
    if (owner !== undefined && owner.length > 0) {
      const owned = this.programByName(`${owner}.${name}`);
      if (owned >= 0) {
        // Reaching a *foreign* owner's beat rebinds `self`, so its SELF
        // speaker resolves as the beat's true owner, not the caller's.
        return { program: owned, rebindSelf: owner };
      }
    }
    if (target.flat >= 0) return { program: target.flat, rebindSelf: null };
    const flat = this.programByName(name);
    return flat >= 0 ? { program: flat, rebindSelf: null } : null;
  }

  private bindingsFor(argsId: number, frame: Frame, rebindSelf: string | null): Map<string, string> {
    const next = new Map(frame.bindings);
    if (rebindSelf !== null) next.set("self", rebindSelf);
    if (argsId >= 0) {
      const table = this.bank.argTables[argsId];
      for (const bind of table?.binds ?? []) {
        next.set(this.bank.names[bind.name] ?? "", displaySpec(this.evalExpr(bind.expr, frame)));
      }
    }
    return next;
  }

  /**
   * Counters, latches, and taken-sets are per subject. In a single-player
   * game the subject is always `""`; the dimension exists so one bank can
   * serve a multi-participant host too.
   */
  private subjectKey(key: string, subject: string): string {
    return `${key}:${subject}`;
  }

  private bumpCounter(key: string, subject: string): number {
    const full = this.subjectKey(key, subject);
    const next = (this.counters.get(full) ?? 0) + 1;
    this.counters.set(full, next);
    return next;
  }

  // -------------------------------------------------------------------
  // State access
  // -------------------------------------------------------------------

  get(path: string): Value {
    return this.world.get(path);
  }

  set(path: string, value: Value): void {
    this.world.set(path, value);
  }

  visitsOf(beatName: string, subject = ""): number {
    const index = this.programsByName.get(beatName);
    if (index === undefined) return 0;
    const hash = this.bank.programs[index]!.hash;
    return this.counters.get(this.subjectKey(`v:${hash}`, subject)) ?? 0;
  }

  drainDiagnostics(): string[] {
    const out = this.diagnostics;
    this.diagnostics = [];
    return out;
  }

  // -------------------------------------------------------------------
  // Persistence — all scalars, no object graph
  // -------------------------------------------------------------------

  save(): SaveState {
    const bank = this.bank;
    return {
      loomSave: 1,
      banks: [...this.banks, ...this.localeBanks].map((b) => ({
        id: b.bankId,
        sourceHash: b.compiler.sourceHash,
      })),
      locale: this.locale,
      elapsedMs: this.elapsedMs,
      world: Object.fromEntries(this.world.entries().map(([k, v]) => [k, toBankValue(v)])),
      frames: this.frames.map((f) => ({
        program: bank.programs[f.program]!.hash,
        pc: f.pc,
        locals: f.locals.map((v) => (v === undefined ? null : toBankValue(v))),
        bindings: [...f.bindings.entries()].sort(([a], [b2]) => (a < b2 ? -1 : a > b2 ? 1 : 0)),
        setting: f.setting,
        cast: f.cast,
        tunnelAnchor: f.tunnelAnchor,
        subject: f.subject,
      })),
      pendingMenu:
        this.pendingMenu === null
          ? null
          : {
              program: bank.programs[this.pendingMenu.program]!.hash,
              menu: this.pendingMenu.menu,
              subject: this.pendingMenu.subject,
              visible: this.pendingMenu.visible,
            },
      counters: [...this.counters.entries()].sort(([a], [b2]) => (a < b2 ? -1 : a > b2 ? 1 : 0)),
      latches: [...this.latches].sort(),
      taken: [...this.taken].sort(),
      programQueue: this.programQueue.map((q) => ({
        program: bank.programs[q.program]!.hash,
        bindings: [...q.bindings.entries()],
      })),
      triggers: [...this.triggers],
      timers: [...this.timers.entries()].sort(([a], [b2]) => (a < b2 ? -1 : a > b2 ? 1 : 0)),
      timerFired: [...this.timerFired].sort(),
      shuffles: [...this.shuffles.entries()]
        .map(([k, v]): [string, string] => [k, hex64(v)])
        .sort(([a], [b2]) => (a < b2 ? -1 : a > b2 ? 1 : 0)),
    };
  }

  load(state: SaveState, allowMigrate = false): LoadResult {
    const bank = this.bank;
    const mismatched = state.banks.find(
      (s) => s.id === bank.bankId && s.sourceHash !== bank.compiler.sourceHash,
    );
    // pcs are meaningless across a recompile, so a changed bank is either
    // refused or migrated — never silently resumed.
    const migrate = mismatched !== undefined;
    if (migrate && !allowMigrate) return { ok: false, reason: "bankChanged" };

    const byHash = new Map(bank.programs.map((p, i) => [p.hash, i]));
    this.locale = state.locale;
    this.elapsedMs = state.elapsedMs;
    for (const [path, value] of Object.entries(state.world)) this.world.set(path, fromBankValue(value));
    this.counters = new Map(state.counters);
    this.latches = new Set(state.latches);
    this.taken = new Set(state.taken);
    this.timers = new Map(state.timers);
    this.timerFired = new Set(state.timerFired ?? []);
    // Shuffle streams are structural keys, so they survive a migration —
    // a replayed site continues its sequence rather than restarting it.
    this.shuffles = new Map((state.shuffles ?? []).map(([k, v]) => [k, parseHex64(v)]));

    if (migrate) {
      // Structural keys survive content edits; positions do not.
      this.frames = [];
      this.pendingMenu = null;
      this.programQueue = [];
      this.triggers = [];
      return { ok: true, reason: "migrated" };
    }

    this.frames = state.frames.map((f) => ({
      program: byHash.get(f.program) ?? 0,
      pc: f.pc,
      locals: f.locals.map((v) => (v === null ? undefined : fromBankValue(v))),
      bindings: new Map(f.bindings),
      setting: f.setting,
      cast: f.cast,
      tunnelAnchor: f.tunnelAnchor,
      subject: f.subject,
    }));
    this.pendingMenu =
      state.pendingMenu === null
        ? null
        : {
            program: byHash.get(state.pendingMenu.program) ?? 0,
            menu: state.pendingMenu.menu,
            subject: state.pendingMenu.subject,
            visible: state.pendingMenu.visible,
          };
    this.programQueue = state.programQueue.map((q) => ({
      program: byHash.get(q.program) ?? 0,
      bindings: new Map(q.bindings),
    }));
    this.triggers = [...state.triggers];
    return { ok: true };
  }
}
