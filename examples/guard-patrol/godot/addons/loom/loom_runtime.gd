## The Loom bank VM for Godot.
##
## A transliteration of the reference interpreter
## (`bank/src/interp.ts`) — the normative semantics live
## there, and `test/run.gd` diffs this implementation's trace against the
## reference's golden output. If the two disagree, this is wrong.
##
## Usage, pull model (the engine drives pacing — typewriter effects, VO,
## animation gates — so the story waits on you, not the reverse):
##
## [codeblock]
## var loom := LoomRuntime.new()
## add_child(loom)
## loom.load_bank_file("res://story/main.loombank")
## loom.start_beat("opening")
## var step := loom.advance()
## while step["step"] != LoomOps.STEP_DONE:
##     match step["step"]:
##         LoomOps.STEP_LINE:   show_line(step["text"], step.get("display", ""))
##         LoomOps.STEP_CHOICE: present(step["options"]); break
##     step = loom.advance()
## [/codeblock]
##
## Signals are emitted alongside for hosts that prefer a push style, but
## `advance()` is the normative surface.
class_name LoomRuntime
extends Node

## Emitted for every step, before the typed signals below.
signal step_emitted(step: Dictionary)
signal beat_entered(beat: String, setting: String)
signal line_emitted(speaker: String, display: String, text: String)
signal choice_presented(options: Array)
signal directive_emitted(verb: String, positional: Array, named: Dictionary, block: int)
signal variable_changed(path: String, value: Variant)
signal story_finished()

const DRAIN_LIMIT := 10000

var bank: LoomBank = null

var _world: Dictionary = {}
var _frames: Array[Dictionary] = []
var _counters: Dictionary = {}
var _latches: Dictionary = {}
var _taken: Dictionary = {}
var _pending_menu: Variant = null
var _triggers: Array[Dictionary] = []
var _program_queue: Array[Dictionary] = []
var _timers: Dictionary = {}
var _timer_fired: Dictionary = {}
var _shuffles: Dictionary = {}
var _locale_banks: Array = []
var _elapsed_ms: float = 0.0
var _locale: String = ""
var _diagnostics: Array[String] = []
var _seed_cache: int = 0
var _seed_parsed := false

## Optional host expression functions: `func(name: String, args: Array) -> Variant`.
## Return null for "not handled" — an unknown call is null, never an error.
var host_call: Callable = Callable()


# --- banks ----------------------------------------------------------------


func load_bank(new_bank: LoomBank) -> bool:
	if new_bank == null or new_bank.load_error != "":
		push_error("LoomRuntime: %s" % ("null bank" if new_bank == null else new_bank.load_error))
		return false
	if str(new_bank.data.get("kind", "")) == "locale":
		# A locale bank is a resource, not story state: text overrides plus
		# its own string table, activated by `set_locale`.
		_locale_banks.append(new_bank.data)
		return true
	# A bank restored from Godot's resource cache (the `.loombank` importer
	# path) arrives with `data` but no derived tables.
	new_bank.build_index()
	bank = new_bank
	_seed_parsed = false
	_seed_world()
	return true


func load_bank_file(path: String) -> bool:
	# Raw file first: in the editor and in tests the `.loombank` source is
	# on disk and always fresh. In an exported game the importer strips the
	# source out of the PCK, so fall back to the imported resource.
	if FileAccess.file_exists(path):
		return load_bank(LoomBank.from_file(path))
	if ResourceLoader.exists(path):
		var res: Resource = load(path)
		if res is LoomBank:
			return load_bank(res)
	return load_bank(LoomBank.from_file(path))


func set_locale(tag: String) -> void:
	_locale = tag


## Seed entity identity strings and typed-slot defaults, so an authored
## `guest.faction == Keepers` reads naturally.
func _seed_world() -> void:
	for path in bank.data.get("globals", {}):
		if not _world.has(path):
			_world[path] = LoomValue.from_bank(bank.data["globals"][path])
	var entities: Dictionary = bank.data.get("entities", {})
	for entity in entities.get("tables", []):
		var id := bank.name_of(int(entity.get("id", -1)))
		for field in entity.get("fields", {}):
			var path := "%s.%s" % [id, field]
			if not _world.has(path):
				_world[path] = LoomValue.from_bank(entity["fields"][field])


# --- execution ------------------------------------------------------------


func program_by_name(beat: String) -> int:
	return bank.program_by_name(beat) if bank != null else -1


func start(program: int, bindings: Dictionary = {}) -> void:
	_frames.clear()
	_pending_menu = null
	_program_queue.clear()
	_triggers.clear()
	if program < 0:
		return
	_program_queue.append({"program": program, "bindings": bindings.duplicate()})


func start_beat(beat: String, bindings: Dictionary = {}) -> void:
	start(program_by_name(beat), bindings)


func start_entry(bindings: Dictionary = {}) -> void:
	start(bank.entry_program() if bank != null else -1, bindings)


func is_waiting() -> bool:
	return _pending_menu != null


## One step of progress. The algorithm is normative — see the spec's §7.2.
func advance() -> Dictionary:
	if bank == null:
		return _error("noBank", "no bank loaded")
	if _pending_menu != null:
		return _emit({"step": LoomOps.STEP_IDLE})

	for _guard in DRAIN_LIMIT:
		if not _frames.is_empty():
			var step: Variant = _run_frames()
			if step != null:
				return _emit(step)
			continue
		if not _program_queue.is_empty():
			var queued: Dictionary = _program_queue.pop_front()
			var entered: Variant = _enter_program(queued["program"], queued["bindings"])
			if entered != null:
				return _emit(entered)
			continue
		if not _triggers.is_empty():
			_match_hooks(_triggers.pop_front())
			continue
		return _emit({"step": LoomOps.STEP_DONE})
	return _error("drainOverflow", "hook drain did not settle")


## Advance until a choice, idle, done, or error. Convenience for hosts that
## render a whole burst at once.
func run() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	while true:
		var step := advance()
		out.append(step)
		var kind: String = step["step"]
		if (
			kind == LoomOps.STEP_CHOICE
			or kind == LoomOps.STEP_DONE
			or kind == LoomOps.STEP_IDLE
			or kind == LoomOps.STEP_ERROR
		):
			break
	return out


func choose(index: int) -> bool:
	if _pending_menu == null:
		return false
	var pending: Dictionary = _pending_menu
	var visible: Array = pending["visible"]
	if index < 0 or index >= visible.size():
		# Validate before consuming, so a mis-tap cannot destroy the menu.
		return false
	var option_index: int = visible[index]
	var menu: Dictionary = bank.table("menus", pending["menu"])
	if menu == null:
		return false
	var option: Dictionary = menu["options"][option_index]

	_pending_menu = null
	# Record every taken option: `sticky` decides whether it is still
	# offered, `suppressed` needs to know it was taken either way.
	_taken[_subject_key(str(option["tag"]), pending["subject"])] = true

	if _frames.is_empty():
		return false
	_frames[-1]["pc"] = int(option["target"])
	return true


func _enter_program(program: int, caller_bindings: Dictionary) -> Variant:
	var info := bank.program(program)
	var beat_name := bank.name_of(int(info.get("name", -1)))

	# A class-owned beat is owned by definition, so its `self` is its owner
	# however it was reached — otherwise a `SELF` cue would fall through to
	# the literal token.
	var bindings := caller_bindings
	if str(info.get("kind", "")) == "ownedBeat":
		var dot := beat_name.find(".")
		if dot > 0:
			var owner := beat_name.substr(0, dot)
			if bindings.get("self", "") != owner:
				bindings = bindings.duplicate()
				bindings["self"] = owner

	var subject: String = str(bindings.get("guest", bindings.get("self", "")))
	var setting := int(info.get("setting", -1))
	if setting < 0 and not _frames.is_empty():
		# A setting-less beat continues in the caller's room.
		setting = int(_frames[-1]["setting"])

	_bump_counter("v:%s" % info.get("hash", ""), subject)
	var locals: Array = []
	locals.resize(maxi(1, int(info.get("localCount", 1))))
	_frames.append({
		"program": program,
		"pc": 0,
		"locals": locals,
		"bindings": bindings,
		"setting": setting,
		"cast": int(info.get("cast", -1)),
		"tunnel_anchor": false,
		"subject": subject,
	})

	# Hooks are internal plumbing: a host sees the lines and writes they
	# produce, not the dispatch itself.
	if str(info.get("kind", "")) == "hook":
		return null
	return {
		"step": LoomOps.STEP_BEAT,
		"program": str(info.get("hash", "")),
		"name": beat_name,
		"setting": bank.hash_of(setting) if setting >= 0 else "",
		"subject": subject,
	}


func _run_frames() -> Variant:
	while not _frames.is_empty():
		var frame: Dictionary = _frames[-1]
		var program: int = frame["program"]
		var info := bank.program(program)
		var words: PackedInt32Array = bank.code[program]
		var base: int = int(frame["pc"]) * LoomOps.WORDS_PER_INSTRUCTION
		if base >= words.size():
			_frames.pop_back()
			continue

		var op: int = words[base]
		var a: int = words[base + 1]
		var b: int = words[base + 2]
		var c: int = words[base + 3]
		var at_pc: int = int(frame["pc"])
		frame["pc"] = at_pc + 1

		match op:
			LoomOps.NOP:
				pass

			LoomOps.NARRATE:
				return _line(0, "", a, frame, info, at_pc)

			LoomOps.SPEAK:
				var speaker: Dictionary = bank.table("speakers", a)
				var resolved := _resolve_speaker(speaker, frame)
				return _line(resolved["hash"], resolved["display"], b, frame, info, at_pc)

			LoomOps.JUMP:
				frame["pc"] = a

			LoomOps.JUMP_IF_NOT:
				if not LoomValue.truthy(_eval_expr(a, frame)):
					frame["pc"] = b

			LoomOps.MATCH:
				var scrutinee: Variant = _eval_expr(a, frame)
				var table: Dictionary = bank.table("switches", b)
				var target: int = int(table.get("default", -1))
				for arm in table.get("cases", []):
					var literal: Variant = LoomValue.from_bank(arm["lit"])
					var hit: bool = (
						LoomValue.display(literal) == LoomValue.display(scrutinee)
						if bank.match_mode() == "display"
						else LoomValue.values_equal(literal, scrutinee)
					)
					if hit:
						target = int(arm["target"])
						break
				if target >= 0:
					frame["pc"] = target

			LoomOps.MENU:
				var step: Variant = _open_menu(a, frame, info)
				if step != null:
					return step

			LoomOps.EACH_VISIT:
				var table: Dictionary = bank.table("visitTables", b)
				var branches: Array = table.get("branches", [])
				var site_keys: Array = info.get("siteKeys", [])
				var key: String = (
					str(site_keys[a]) if a < site_keys.size() else "%s#%d" % [info["hash"], a]
				)
				var n := _bump_counter(key, frame["subject"])
				if branches.is_empty():
					frame["pc"] = int(table.get("resume", frame["pc"]))
				else:
					# Clamp to the last authored branch, so `finally` sticks.
					frame["pc"] = int(branches[mini(n, branches.size()) - 1])

			LoomOps.AFTER:
				var site_keys: Array = info.get("siteKeys", [])
				var raw_key: String = (
					str(site_keys[a]) if a < site_keys.size() else "%s#%d" % [info["hash"], a]
				)
				var key := _subject_key(raw_key, frame["subject"])
				if _latches.has(key) or LoomValue.truthy(_eval_expr(b, frame)):
					# Latch permanently, as the writer's guide promises.
					_latches[key] = true
				else:
					frame["pc"] = c

			LoomOps.LET:
				frame["locals"][a] = _eval_expr(b, frame)

			LoomOps.CLEAR_LOCALS:
				for i in b:
					if a + i < frame["locals"].size():
						frame["locals"][a + i] = null

			LoomOps.SET:
				return _apply_set(a, frame)

			LoomOps.SIGNAL:
				_triggers.append({"verb": bank.name_of(a), "subject": "", "filter": ""})
				return {
					"step": LoomOps.STEP_SIGNAL, "verb": bank.hash_of(a), "subject": "",
				}

			LoomOps.HOST:
				return _host_step(a, b, c, frame)

			LoomOps.DIVERT, LoomOps.TUNNEL:
				var resolved: Variant = _resolve_target(a, frame)
				if resolved == null:
					return _error("unresolvedTarget", "divert target %d" % a)
				if op == LoomOps.TUNNEL:
					frame["tunnel_anchor"] = true
				var bindings := _bindings_for(b, frame, resolved["rebind_self"])
				var entered: Variant = _enter_program(resolved["program"], bindings)
				if entered != null:
					return entered

			LoomOps.RETURN:
				# `TUNNEL` flags the *calling* frame, so unwind until the
				# frame below the popped one is that caller.
				var found := false
				while not _frames.is_empty():
					_frames.pop_back()
					if not _frames.is_empty() and _frames[-1]["tunnel_anchor"]:
						_frames[-1]["tunnel_anchor"] = false
						found = true
						break
				if not found:
					_frames.clear()

			LoomOps.END:
				_frames.clear()
				return null

			LoomOps.HALT:
				_frames.pop_back()

			LoomOps.SHUFFLE:
				var table: Dictionary = bank.table("visitTables", b)
				var branches: Array = table.get("branches", [])
				if branches.is_empty():
					frame["pc"] = int(table.get("resume", frame["pc"]))
				else:
					var site_keys: Array = info.get("siteKeys", [])
					var site_key: String = (
						str(site_keys[a]) if a < site_keys.size() else "%s#%d" % [info["hash"], a]
					)
					var key := _subject_key(site_key, frame["subject"])
					var state: int = (
						int(_shuffles[key]) if _shuffles.has(key)
						else LoomHash.shuffle_seed(_bank_seed(), site_key)
					)
					state = LoomHash.xorshift64_next(state)
					_shuffles[key] = state
					frame["pc"] = int(branches[LoomHash.shuffle_pick(state, branches.size())])

			LoomOps.CALL_SLOT:
				_diagnostics.append("opcode %d is reserved and not executed in v1" % op)

			_:
				return _error("badOpcode", "opcode %d" % op)

	return null


func _line(
	speaker: Variant, display_name: String, text_id: int,
	frame: Dictionary, info: Dictionary, at_pc: int
) -> Dictionary:
	var step := {
		"step": LoomOps.STEP_LINE,
		"speaker": speaker,
		"text": _render_text(text_id, frame),
	}
	if display_name != "":
		step["display"] = display_name
	var setting: int = frame["setting"]
	if setting >= 0:
		step["setting"] = bank.hash_of(setting)
	var note := _note_at(info, at_pc)
	if note != "":
		step["note"] = note
	return step


func _open_menu(menu_id: int, frame: Dictionary, info: Dictionary) -> Variant:
	var menu: Dictionary = bank.table("menus", menu_id)
	var options: Array = menu.get("options", [])
	var visible: Array = []
	for i in options.size():
		var option: Dictionary = options[i]
		var tag_key := _subject_key(str(option["tag"]), frame["subject"])
		if not bool(option.get("sticky", false)) and _taken.has(tag_key):
			continue
		var cond := int(option.get("cond", -1))
		if cond >= 0 and not LoomValue.truthy(_eval_expr(cond, frame)):
			continue
		visible.append(i)

	# The frame's cursor parks at the resume point; `choose` redirects it
	# into the option body.
	frame["pc"] = int(menu.get("resume", frame["pc"]))

	if visible.is_empty():
		# An exhausted menu reports idle once and then continues — a menu
		# must never be a dead end.
		return {"step": LoomOps.STEP_IDLE}

	_pending_menu = {
		"program": frame["program"],
		"menu": menu_id,
		"subject": frame["subject"],
		"visible": visible,
	}
	var rendered: Array = []
	for slot in visible.size():
		var option: Dictionary = options[visible[slot]]
		var taken := _taken.has(_subject_key(str(option["tag"]), frame["subject"]))
		var suppressed := int(option.get("suppressed", -1))
		var text_id := suppressed if taken and suppressed >= 0 else int(option["text"])
		rendered.append({
			"i": slot, "text": _render_text(text_id, frame), "tag": str(option["tag"]),
		})
	return {
		"step": LoomOps.STEP_CHOICE,
		"menu": "%s:%d" % [info.get("hash", ""), menu_id],
		"options": rendered,
	}


func _apply_set(set_id: int, frame: Dictionary) -> Dictionary:
	var entry: Dictionary = bank.table("sets", set_id)
	var path := _expand_path(int(entry["path"]), frame)
	var next: Variant = _eval_expr(int(entry["expr"]), frame)
	var fallback := int(entry.get("enum", -1))
	if next == null and fallback >= 0:
		# A bare-identifier RHS doubles as a string when it resolves to
		# nothing: `<set: g.faction = Mods>`.
		next = bank.string_of(fallback)
	var op: String = str(entry["op"])
	if op != "=":
		var current := LoomValue._num(_world.get(path))
		var operand := LoomValue._num(next)
		match op:
			"+=":
				next = current + operand
			"-=":
				next = current - operand
			"*=":
				next = current * operand
			"/=":
				next = LoomValue.apply_binary(LoomOps.E_DIV, current, operand)
	_world[path] = next
	return {"step": LoomOps.STEP_VARSET, "path": path, "value": LoomValue.to_bank(next)}


func _host_step(verb_id: int, args_id: int, mode: int, frame: Dictionary) -> Dictionary:
	var positional: Array = []
	var named: Dictionary = {}
	var raw := ""
	if args_id >= 0:
		var args: Dictionary = bank.table("directiveArgs", args_id)
		for text_id in args.get("positional", []):
			positional.append(_render_text(int(text_id), frame))
		for pair in args.get("named", []):
			named[bank.name_of(int(pair["key"]))] = _render_text(int(pair["text"]), frame)
		raw = _render_text(int(args.get("raw", -1)), frame)
	return {
		"step": LoomOps.STEP_DIRECTIVE,
		"verb": bank.hash_of(verb_id),
		"verbName": bank.name_of(verb_id),
		"positional": positional,
		"named": named,
		"raw": raw,
		"block": LoomOps.HOST_LEAF if mode == -1 else mode,
	}


# --- hooks ----------------------------------------------------------------


func signal_event(verb: String, subject: String = "", filter: String = "") -> void:
	_triggers.append({"verb": verb, "subject": subject, "filter": filter})


func _match_hooks(trigger: Dictionary) -> void:
	# Bank order is frozen at compile time, because map iteration order is
	# not portable across runtimes.
	var hooks: Array = bank.data.get("hooks", [])
	var ordered := hooks.duplicate()
	ordered.sort_custom(func(x, y): return int(x["order"]) < int(y["order"]))
	for hook in ordered:
		if bank.name_of(int(hook["verb"])) != trigger["verb"]:
			continue
		var filter := int(hook.get("filter", -1))
		if filter >= 0 and bank.name_of(filter) != trigger["filter"]:
			continue
		var bindings := {"self": bank.name_of(int(hook["owner"]))}
		var param := int(hook.get("param", -1))
		if param >= 0 and str(trigger["subject"]) != "":
			bindings[bank.name_of(param)] = trigger["subject"]
		_program_queue.append({"program": int(hook["program"]), "bindings": bindings})


func tick(dt_ms: float) -> void:
	_elapsed_ms += dt_ms
	_world["Time.elapsed"] = _elapsed_ms
	_world["Time.minute"] = floor(_elapsed_ms / 60000.0)
	for hook in bank.data.get("hooks", []):
		var timer: Variant = hook.get("timer")
		if timer == null:
			continue
		var key := "%d:%d:%d" % [int(hook["owner"]), int(hook["verb"]), int(hook["program"])]
		var mode: String = str(timer["mode"])
		if mode == "after" and _timer_fired.has(key):
			continue
		if _elapsed_ms < float(_timers.get(key, 0.0)) + float(timer["ms"]):
			continue
		_timers[key] = _elapsed_ms
		if mode == "after":
			_timer_fired[key] = true
		_program_queue.append({
			"program": int(hook["program"]),
			"bindings": {"self": bank.name_of(int(hook["owner"]))},
		})


# --- expressions ----------------------------------------------------------


func _eval_expr(expr_id: int, frame: Dictionary) -> Variant:
	var ref: Dictionary = bank.table("exprs", expr_id)
	if ref == null:
		return null
	return _eval_range(int(ref["at"]), int(ref["len"]), frame)


## Walk one RPN window: a flat loop over an int array with an explicit
## value stack. Deliberately not recursive — this is the hot path.
func _eval_range(at: int, length: int, frame: Dictionary) -> Variant:
	var words: Array = bank.data.get("exprCode", [])
	var nums: Array = bank.data.get("exprConsts", {}).get("nums", [])
	var stack: Array = []
	var end := at + length
	var ip := at

	while ip < end:
		var op: int = int(words[ip])
		ip += 1
		match op:
			LoomOps.E_NULL:
				stack.append(null)
			LoomOps.E_TRUE:
				stack.append(true)
			LoomOps.E_FALSE:
				stack.append(false)
			LoomOps.E_NUM:
				stack.append(float(nums[int(words[ip])]))
				ip += 1
			LoomOps.E_STR:
				stack.append(bank.string_of(int(words[ip])))
				ip += 1
			LoomOps.E_PATH:
				stack.append(_world.get(_expand_path(int(words[ip]), frame)))
				ip += 1
			LoomOps.E_LOCAL:
				var slot := int(words[ip])
				ip += 1
				stack.append(frame["locals"][slot] if slot < frame["locals"].size() else null)
			LoomOps.E_LIST:
				var n := int(words[ip])
				ip += 1
				var items: Array = []
				for _i in n:
					items.push_front(stack.pop_back())
				stack.append(items)
			LoomOps.E_NEG:
				stack.append(-LoomValue._num(stack.pop_back()))
			LoomOps.E_NOT:
				stack.append(not LoomValue.truthy(stack.pop_back()))
			LoomOps.E_ADD, LoomOps.E_SUB, LoomOps.E_MUL, LoomOps.E_DIV, LoomOps.E_MOD, \
			LoomOps.E_EQ, LoomOps.E_NE, LoomOps.E_LT, LoomOps.E_LE, LoomOps.E_GT, LoomOps.E_GE:
				var right: Variant = stack.pop_back()
				var left: Variant = stack.pop_back()
				stack.append(LoomValue.apply_binary(op, left, right))
			LoomOps.E_JUMP_FALSE_POP:
				var rel := int(words[ip])
				ip += 1
				if not LoomValue.truthy(stack[-1]):
					stack[-1] = false
					ip += rel
				else:
					stack.pop_back()
			LoomOps.E_JUMP_TRUE_POP:
				var rel := int(words[ip])
				ip += 1
				if LoomValue.truthy(stack[-1]):
					stack[-1] = true
					ip += rel
				else:
					stack.pop_back()
			LoomOps.E_TO_BOOL:
				stack.append(LoomValue.truthy(stack.pop_back()))
			LoomOps.E_CALL:
				var call_name := bank.name_of(int(words[ip]))
				var argc := int(words[ip + 1])
				ip += 2
				var args: Array = []
				for _i in argc:
					args.push_front(stack.pop_back())
				stack.append(_call_builtin(call_name, args, frame))
			LoomOps.E_COMPREHENSION:
				var slot := int(words[ip])
				var value_len := int(words[ip + 1])
				var filter_len := int(words[ip + 2])
				ip += 3
				# The two sub-programs sit inline, right after the operands.
				var value_at := ip
				var filter_at := ip + value_len
				var source: Variant = stack.pop_back()
				var items: Array = source if typeof(source) == TYPE_ARRAY else []
				var out: Array = []
				var saved: Variant = frame["locals"][slot] if slot < frame["locals"].size() else null
				for item in items:
					_set_local(frame, slot, item)
					if filter_len > 0 and not LoomValue.truthy(
						_eval_range(filter_at, filter_len, frame)
					):
						continue
					out.append(_eval_range(value_at, value_len, frame))
				_set_local(frame, slot, saved)
				stack.append(out)
				ip = filter_at + filter_len
			_:
				# Unknown opcode: skip its operands and yield null rather
				# than desynchronising the walk.
				ip += int(LoomOps.E_ARITY.get(op, 0))
				stack.append(null)

	return stack.pop_back() if not stack.is_empty() else null


func _set_local(frame: Dictionary, slot: int, value: Variant) -> void:
	var locals: Array = frame["locals"]
	while locals.size() <= slot:
		locals.append(null)
	locals[slot] = value


func _call_builtin(call_name: String, args: Array, frame: Dictionary) -> Variant:
	match call_name:
		"count":
			return float((args[0] as Array).size()) if (
				args.size() > 0 and typeof(args[0]) == TYPE_ARRAY
			) else 0.0
		"visits":
			var beat := LoomValue.display(args[0]) if args.size() > 0 else ""
			return float(visits_of(beat, frame["subject"]))
	if host_call.is_valid():
		var hosted: Variant = host_call.call(call_name, args)
		if hosted != null:
			return hosted
	# An unknown call is null, never an error — authored scripts lean on it.
	return null


# --- helpers --------------------------------------------------------------


## Bindings substitute per path *segment*, so `self.trust` → `Wren.trust`.
func _expand_path(path_id: int, frame: Dictionary) -> String:
	var path: Dictionary = bank.table("paths", path_id)
	if path == null:
		return ""
	var bindings: Dictionary = frame["bindings"]
	var parts: Array[String] = []
	for seg in path.get("segs", []):
		var segment := bank.name_of(int(seg))
		parts.append(str(bindings.get(segment, segment)))
	return ".".join(parts)


func _render_text(text_id: int, frame: Dictionary) -> String:
	var entry: Dictionary = bank.table("texts", text_id)
	if entry == null:
		return ""

	# Locale override: literal parts resolve against the *locale bank's*
	# string table, expressions against the content bank as ever.
	# Unmatched keys fall back to the source.
	if _locale != "" and entry.has("loc"):
		for locale_bank in _locale_banks:
			if str(locale_bank.get("locale", "")) != _locale:
				continue
			var override: Variant = (locale_bank.get("texts", {}) as Dictionary).get(
				str(entry["loc"])
			)
			if override == null:
				continue
			var locale_strings: Array = locale_bank.get("strings", [])
			var translated := ""
			for part in override.get("parts", []):
				if str(part.get("k", "")) == "lit":
					var s := int(part["s"])
					translated += (
						str(locale_strings[s]) if s >= 0 and s < locale_strings.size() else ""
					)
				else:
					translated += LoomValue.display(_eval_expr(int(part["e"]), frame))
			return translated

	var out := ""
	for part in entry.get("parts", []):
		if str(part.get("k", "")) == "lit":
			out += bank.string_of(int(part["s"]))
		else:
			out += LoomValue.display(_eval_expr(int(part["e"]), frame))
	return out


func _bank_seed() -> int:
	if not _seed_parsed:
		_seed_parsed = true
		_seed_cache = LoomHash.hex64_to_int(str(bank.data.get("seed", "")))
	return _seed_cache


func _note_at(info: Dictionary, pc: int) -> String:
	for note in info.get("notes", []):
		if int(note.get("pc", -1)) == pc:
			return str(note.get("text", ""))
	return ""


func _resolve_speaker(speaker: Dictionary, frame: Dictionary) -> Dictionary:
	if str(speaker.get("mode", "lit")) == "lit":
		var ids: Array = speaker.get("ids", [])
		var id := int(ids[0]) if not ids.is_empty() else -1
		return {
			"hash": bank.hash_of(id) if id >= 0 else "",
			"display": bank.name_of(int(speaker.get("display", -1))),
		}
	# `SELF`/`ME`: whoever routed in, else the beat's first cast member,
	# else the literal token. The *upper-cased* form is the identity, so a
	# SELF line and an explicit WREN cue are the same speaker.
	var bindings: Dictionary = frame["bindings"]
	var who: String = str(bindings.get("self", ""))
	if who == "":
		who = bank.name_of(int(frame["cast"]))
	if who == "":
		who = "SELF"
	var display_name := who.to_upper()
	return {"hash": LoomHash.fnv1a64_hex(display_name), "display": display_name}


func _resolve_target(target_id: int, frame: Dictionary) -> Variant:
	var target: Dictionary = bank.table("targets", target_id)
	if target == null:
		return null
	var kind: String = str(target.get("kind", ""))
	if kind == "local":
		return {"program": int(target["program"]), "rebind_self": ""}
	if kind == "extern":
		return null

	var beat := bank.name_of(int(target["name"]))
	var qualifier: Variant = target.get("qualifier")
	var owner := ""
	if qualifier == "self":
		owner = str(frame["bindings"].get("self", ""))
	elif qualifier != null:
		owner = str(qualifier)
	if owner != "":
		var owned := bank.program_by_name("%s.%s" % [owner, beat])
		if owned >= 0:
			# A *foreign* owner's beat rebinds `self`, so its SELF speaker
			# resolves as the beat's true owner, not the caller's.
			return {"program": owned, "rebind_self": owner}
	var flat := int(target.get("flat", -1))
	if flat >= 0:
		return {"program": flat, "rebind_self": ""}
	var global_program := bank.program_by_name(beat)
	return {"program": global_program, "rebind_self": ""} if global_program >= 0 else null


func _bindings_for(args_id: int, frame: Dictionary, rebind_self: String) -> Dictionary:
	var next: Dictionary = (frame["bindings"] as Dictionary).duplicate()
	if rebind_self != "":
		next["self"] = rebind_self
	if args_id >= 0:
		var table: Dictionary = bank.table("argTables", args_id)
		for bind in table.get("binds", []):
			next[bank.name_of(int(bind["name"]))] = LoomValue.display(
				_eval_expr(int(bind["expr"]), frame)
			)
	return next


## Counters, latches, and taken-sets are per subject. In a single-player
## game the subject is always "" — the dimension exists so one bank can
## serve a multi-participant host too.
func _subject_key(key: String, subject: Variant) -> String:
	return "%s:%s" % [key, str(subject)]


func _bump_counter(key: String, subject: Variant) -> int:
	var full := _subject_key(key, subject)
	var next := int(_counters.get(full, 0)) + 1
	_counters[full] = next
	return next


func _emit(step: Dictionary) -> Dictionary:
	step_emitted.emit(step)
	match str(step["step"]):
		LoomOps.STEP_BEAT:
			beat_entered.emit(step["name"], step["setting"])
		LoomOps.STEP_LINE:
			# Narration carries speaker `0` in the step (the bank format's
			# "no speaker"); the typed signal renders that as "".
			var speaker: Variant = step["speaker"]
			line_emitted.emit(
				speaker if typeof(speaker) == TYPE_STRING else "",
				step.get("display", ""),
				step["text"],
			)
		LoomOps.STEP_CHOICE:
			choice_presented.emit(step["options"])
		LoomOps.STEP_DIRECTIVE:
			directive_emitted.emit(
				step["verbName"], step["positional"], step["named"], step["block"]
			)
		LoomOps.STEP_VARSET:
			variable_changed.emit(step["path"], LoomValue.from_bank(step["value"]))
		LoomOps.STEP_DONE:
			story_finished.emit()
	return step


func _error(code: String, message: String) -> Dictionary:
	return _emit({"step": LoomOps.STEP_ERROR, "code": code, "message": message})


# --- state access ---------------------------------------------------------


func get_var(path: String) -> Variant:
	return _world.get(path)


func set_var(path: String, value: Variant) -> void:
	_world[path] = value


func visits_of(beat: String, subject: Variant = "") -> int:
	var index := bank.program_by_name(beat)
	if index < 0:
		return 0
	var story_hash: String = str(bank.program(index).get("hash", ""))
	return int(_counters.get(_subject_key("v:%s" % story_hash, subject), 0))


func has_played(beat: String, subject: Variant = "") -> bool:
	return visits_of(beat, subject) > 0


## The beat the story is currently inside — the innermost frame that is a
## real beat (hook bodies are internal plumbing). "" when nothing plays.
func current_beat() -> String:
	if bank == null:
		return ""
	for i in range(_frames.size() - 1, -1, -1):
		var info := bank.program(int(_frames[i]["program"]))
		if str(info.get("kind", "")) != "hook":
			return bank.name_of(int(info.get("name", -1)))
	return ""


## The current frame's setting (a LOCATION name), or "".
func current_setting() -> String:
	if bank == null or _frames.is_empty():
		return ""
	var setting := int(_frames[-1]["setting"])
	return bank.name_of(setting) if setting >= 0 else ""


## True when the story has no work left at all: no frames, no queued
## programs or triggers, and no suspended choice. Distinct from
## [method is_waiting], which is "parked on a menu".
func is_finished() -> bool:
	return (
		_frames.is_empty()
		and _program_queue.is_empty()
		and _triggers.is_empty()
		and _pending_menu == null
	)


## The suspended choice's options, rendered exactly as the `choice` step
## presented them (`{i, text, tag}`), or `[]` when nothing is pending —
## so a save/load UI or an inspector can show the menu without replaying
## the step.
func pending_options() -> Array:
	if _pending_menu == null or _frames.is_empty() or bank == null:
		return []
	var menu: Dictionary = bank.table("menus", _pending_menu["menu"])
	if menu == null:
		return []
	var options: Array = menu.get("options", [])
	var frame: Dictionary = _frames[-1]
	var visible: Array = _pending_menu["visible"]
	var rendered: Array = []
	for slot in visible.size():
		var option: Dictionary = options[visible[slot]]
		var taken := _taken.has(_subject_key(str(option["tag"]), _pending_menu["subject"]))
		var suppressed := int(option.get("suppressed", -1))
		var text_id := suppressed if taken and suppressed >= 0 else int(option["text"])
		rendered.append({
			"i": slot, "text": _render_text(text_id, frame), "tag": str(option["tag"]),
		})
	return rendered


## A copy of every story variable, keyed by dotted path — for debug
## panels, quest logs, or save-slot summaries.
func world_snapshot() -> Dictionary:
	return _world.duplicate()


func drain_diagnostics() -> Array[String]:
	var out := _diagnostics.duplicate()
	_diagnostics.clear()
	return out


# --- persistence ----------------------------------------------------------


## Serialise the whole VM. Every leaf is a scalar — this is the property
## that makes a Loom bank savable where the live AST-walking engine is not.
func save() -> Dictionary:
	var world_out := {}
	var keys: Array = _world.keys()
	keys.sort()
	for key in keys:
		world_out[key] = LoomValue.to_bank(_world[key])

	var frames_out: Array = []
	for frame in _frames:
		var locals_out: Array = []
		for value in frame["locals"]:
			locals_out.append(null if value == null else LoomValue.to_bank(value))
		var binding_keys: Array = (frame["bindings"] as Dictionary).keys()
		binding_keys.sort()
		var bindings_out: Array = []
		for key in binding_keys:
			bindings_out.append([key, frame["bindings"][key]])
		frames_out.append({
			"program": str(bank.program(frame["program"]).get("hash", "")),
			"pc": frame["pc"],
			"locals": locals_out,
			"bindings": bindings_out,
			"setting": frame["setting"],
			"cast": frame["cast"],
			"tunnelAnchor": frame["tunnel_anchor"],
			"subject": frame["subject"],
		})

	var pending_out: Variant = null
	if _pending_menu != null:
		pending_out = {
			"program": str(bank.program(_pending_menu["program"]).get("hash", "")),
			"menu": _pending_menu["menu"],
			"subject": _pending_menu["subject"],
			"visible": _pending_menu["visible"],
		}

	var banks_out: Array = [{"id": bank.bank_id(), "sourceHash": bank.source_hash()}]
	for locale_bank in _locale_banks:
		banks_out.append({
			"id": str(locale_bank.get("bankId", "")),
			"sourceHash": str((locale_bank.get("compiler", {}) as Dictionary).get("sourceHash", "")),
		})

	var shuffles_out: Array = []
	for key in _sorted_keys(_shuffles):
		shuffles_out.append([key, LoomHash.to_hex(int(_shuffles[key]))])

	return {
		"loomSave": 1,
		"banks": banks_out,
		"locale": _locale,
		"elapsedMs": _elapsed_ms,
		"world": world_out,
		"frames": frames_out,
		"pendingMenu": pending_out,
		"counters": _sorted_pairs(_counters),
		"latches": _sorted_keys(_latches),
		"taken": _sorted_keys(_taken),
		"programQueue": _queue_out(),
		"triggers": _triggers.duplicate(),
		"timers": _sorted_pairs(_timers),
		"timerFired": _sorted_keys(_timer_fired),
		"shuffles": shuffles_out,
	}


func load_state(state: Dictionary, allow_migrate: bool = false) -> Dictionary:
	var changed := false
	for entry in state.get("banks", []):
		if str(entry.get("id", "")) == bank.bank_id():
			changed = str(entry.get("sourceHash", "")) != bank.source_hash()
	# pcs are meaningless across a recompile, so a changed bank is either
	# refused or migrated — never silently resumed at a stale position.
	if changed and not allow_migrate:
		return {"ok": false, "reason": "bankChanged"}

	_locale = str(state.get("locale", ""))
	_elapsed_ms = float(state.get("elapsedMs", 0.0))
	for path in state.get("world", {}):
		_world[path] = LoomValue.from_bank(state["world"][path])
	_counters = _pairs_in(state.get("counters", []))
	_latches = _keys_in(state.get("latches", []))
	_taken = _keys_in(state.get("taken", []))
	_timers = _pairs_in(state.get("timers", []))
	_timer_fired = _keys_in(state.get("timerFired", []))
	# Shuffle streams are structural keys, so they survive a migration —
	# a replayed site continues its sequence rather than restarting it.
	_shuffles = {}
	for row in state.get("shuffles", []):
		_shuffles[str(row[0])] = LoomHash.hex64_to_int(str(row[1]))

	if changed:
		# Structural keys survive content edits; positions do not.
		_frames.clear()
		_pending_menu = null
		_program_queue.clear()
		_triggers.clear()
		return {"ok": true, "reason": "migrated"}

	_frames.clear()
	for frame in state.get("frames", []):
		var locals: Array = []
		for value in frame.get("locals", []):
			locals.append(null if value == null else LoomValue.from_bank(value))
		var bindings := {}
		for pair in frame.get("bindings", []):
			bindings[str(pair[0])] = str(pair[1])
		_frames.append({
			"program": int(bank.program_hashes.get(str(frame["program"]), 0)),
			"pc": int(frame["pc"]),
			"locals": locals,
			"bindings": bindings,
			"setting": int(frame["setting"]),
			"cast": int(frame["cast"]),
			"tunnel_anchor": bool(frame.get("tunnelAnchor", false)),
			"subject": str(frame.get("subject", "")),
		})

	_pending_menu = null
	var pending: Variant = state.get("pendingMenu")
	if pending != null:
		_pending_menu = {
			"program": int(bank.program_hashes.get(str(pending["program"]), 0)),
			"menu": int(pending["menu"]),
			"subject": str(pending["subject"]),
			"visible": pending["visible"],
		}

	_program_queue.clear()
	for queued in state.get("programQueue", []):
		var bindings := {}
		for pair in queued.get("bindings", []):
			bindings[str(pair[0])] = str(pair[1])
		_program_queue.append({
			"program": int(bank.program_hashes.get(str(queued["program"]), 0)),
			"bindings": bindings,
		})

	_triggers.clear()
	for trigger in state.get("triggers", []):
		_triggers.append(trigger)
	return {"ok": true}


func _sorted_keys(source: Dictionary) -> Array:
	var keys: Array = source.keys()
	keys.sort()
	return keys


func _sorted_pairs(source: Dictionary) -> Array:
	var out: Array = []
	for key in _sorted_keys(source):
		out.append([key, source[key]])
	return out


func _pairs_in(rows: Array) -> Dictionary:
	var out := {}
	for row in rows:
		out[str(row[0])] = row[1]
	return out


func _keys_in(rows: Array) -> Dictionary:
	var out := {}
	for row in rows:
		out[str(row)] = true
	return out


func _queue_out() -> Array:
	var out: Array = []
	for queued in _program_queue:
		var binding_keys: Array = (queued["bindings"] as Dictionary).keys()
		binding_keys.sort()
		var bindings_out: Array = []
		for key in binding_keys:
			bindings_out.append([key, queued["bindings"][key]])
		out.append({
			"program": str(bank.program(queued["program"]).get("hash", "")),
			"bindings": bindings_out,
		})
	return out
