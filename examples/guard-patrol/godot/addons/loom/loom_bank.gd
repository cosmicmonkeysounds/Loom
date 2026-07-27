## A loaded `.loombank` — the compiled story data.
##
## Holds the parsed bank as plain Dictionaries/Arrays. Instruction streams
## are converted to [PackedInt32Array] on load, which is the whole reason
## the format uses fixed 4-word instructions: the hot loop indexes a packed
## buffer rather than walking a Dictionary tree.
class_name LoomBank
extends Resource

## The parsed bank. Exported so an imported `.loombank` round-trips through
## Godot's own resource serialisation; the lookup tables below are derived
## and rebuilt on demand rather than stored.
@export var data: Dictionary = {}

## `programs[i].code` as packed buffers, parallel to `programs`.
var code: Array[PackedInt32Array] = []
## Name → dense id, so speaker and beat lookups are not linear scans.
var name_ids: Dictionary = {}
## Beat name → program index.
var program_ids: Dictionary = {}
## Program hash → program index, for save/load and cross-bank diverts.
var program_hashes: Dictionary = {}

var load_error: String = ""
var _indexed: bool = false


static func from_json(text: String) -> LoomBank:
	var bank := LoomBank.new()
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		bank.load_error = "bank is not a JSON object"
		return bank

	var dict: Dictionary = parsed
	var format: int = int(dict.get("loomBank", 0))
	if format != LoomOps.BANK_FORMAT_VERSION:
		# Refuse loudly rather than misreading a future layout.
		bank.load_error = (
			"bank format %d, runtime expects %d" % [format, LoomOps.BANK_FORMAT_VERSION]
		)
		return bank
	var abi: int = int(dict.get("abi", 0))
	if abi != LoomOps.BANK_ABI_VERSION:
		bank.load_error = "bank ABI %d, runtime expects %d" % [abi, LoomOps.BANK_ABI_VERSION]
		return bank

	bank.data = dict
	bank.build_index()
	return bank


## Derive the lookup tables from `data`. Idempotent, and called lazily so a
## bank restored from Godot's own resource cache indexes itself.
func build_index() -> void:
	if _indexed:
		return
	_indexed = true
	code.clear()
	name_ids.clear()
	program_ids.clear()
	program_hashes.clear()

	var names: Array = data.get("names", [])
	for id in names.size():
		if not name_ids.has(names[id]):
			name_ids[names[id]] = id

	var programs: Array = data.get("programs", [])
	for index in programs.size():
		var program: Dictionary = programs[index]
		var packed := PackedInt32Array()
		var words: Array = program.get("code", [])
		packed.resize(words.size())
		for w in words.size():
			packed[w] = int(words[w])
		code.append(packed)
		program_ids[names[int(program.get("name", 0))]] = index
		program_hashes[str(program.get("hash", ""))] = index


static func from_file(path: String) -> LoomBank:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		var bank := LoomBank.new()
		bank.load_error = "cannot open %s" % path
		return bank
	return from_json(file.get_as_text())


func name_of(id: int) -> String:
	var names: Array = data.get("names", [])
	return str(names[id]) if id >= 0 and id < names.size() else ""


func hash_of(id: int) -> String:
	var hashes: Array = data.get("nameHashes", [])
	return str(hashes[id]) if id >= 0 and id < hashes.size() else ""


func string_of(id: int) -> String:
	var strings: Array = data.get("strings", [])
	return str(strings[id]) if id >= 0 and id < strings.size() else ""


func program(index: int) -> Dictionary:
	var programs: Array = data.get("programs", [])
	return programs[index] if index >= 0 and index < programs.size() else {}


func program_by_name(beat: String) -> int:
	return int(program_ids.get(beat, -1))


func table(section: String, index: int) -> Variant:
	var rows: Array = data.get(section, [])
	return rows[index] if index >= 0 and index < rows.size() else null


## Every playable beat in the bank (top-level and class-owned, hooks
## excluded), sorted — the names [method LoomRuntime.start_beat] accepts.
func beat_names() -> Array[String]:
	build_index()
	var names: Array = data.get("names", [])
	var out: Array[String] = []
	for program in data.get("programs", []):
		var kind := str(program.get("kind", ""))
		if kind == "beat" or kind == "ownedBeat":
			out.append(str(names[int(program.get("name", 0))]))
	out.sort()
	return out


func entry_program() -> int:
	return int(data.get("entry", -1))


func match_mode() -> String:
	return str(data.get("matchMode", "value"))


func source_hash() -> String:
	var compiler: Dictionary = data.get("compiler", {})
	return str(compiler.get("sourceHash", ""))


func bank_id() -> String:
	return str(data.get("bankId", ""))
