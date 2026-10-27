## A headset's station configuration — `docs/loom-reinstall.md` §5.
##
## Precedence, lowest first: the built-in defaults → `res://config/station.json`
## (committed, placeholders) → `user://station.json` (written by the headset's
## own SET UP panel, [method save_user], or pushed with `adb`) → the command
## line after `--`:
##
##   godot --path . -- --server http://10.0.0.2:7000 --code 4821 \
##         --station vr-1 --name "Headset 1" [--guest g-3f9a1c] [--offline] [--smooth-turn]
##         [--autopilot [--hit-king]] [--voice false] [--mic false] [--trail-delay 0]
##
## `voice` (default on) is the voice link (wave 19): the terminals heard in
## the house, this headset heard on them; `mic` (default on) off = listen only.
##
## `trail_delay` (seconds, default [constant HouseRoute.PATH_REVEAL_MS] / 1000:
## a minute, wave 26 R2) holds the golden trail back at the start of each
## walk; dev runs and tests may set 0.
##
## `--autopilot` (dev / CI only) walks the trail to the duck by itself and
## quits when the session is over — see [Autopilot]. With `--hit-king` it
## walks to the King first and hits him once (the shared bar's end-to-end
## check).
##
## `--key value` and `--key=value` both work. Pure: everything but
## [method load_station], [method save_user] and [method forget_user] takes
## its inputs as arguments, so the tests drive it. Never write a dev file
## under `res://config/`: the Quest preset ships `config/*.json`.
class_name StationConfig
extends RefCounted

const RES_PATH := "res://config/station.json"
const USER_PATH := "user://station.json"
## The passcode the committed file carries: an unconfigured station never
## dials the server.
const PLACEHOLDER_CODE := "CHANGEME"

## Keys and their types; anything else in a file or on the command line is
## ignored.
const KEYS := {
	"server": TYPE_STRING,
	"code": TYPE_STRING,
	"station": TYPE_STRING,
	"name": TYPE_STRING,
	"guest": TYPE_STRING,
	"offline": TYPE_BOOL,
	"smooth_turn": TYPE_BOOL,
	"autopilot": TYPE_BOOL,
	"hit_king": TYPE_BOOL,
	"voice": TYPE_BOOL,
	"mic": TYPE_BOOL,
	"trail_delay": TYPE_FLOAT,
}


static func defaults() -> Dictionary:
	return {
		"server": "http://127.0.0.1:7000",
		"code": "",
		"station": "vr-1",
		"name": "Headset",
		"guest": "",
		"offline": false,
		"smooth_turn": false,
		"autopilot": false,
		"hit_king": false,
		"voice": true,
		"mic": true,
		"trail_delay": HouseRoute.PATH_REVEAL_MS / 1000.0,
	}


## `base` with every known, well-typed key of `overlay` applied. Strings are
## trimmed; an empty string never overrides.
static func merge(base: Dictionary, overlay: Dictionary) -> Dictionary:
	var out := base.duplicate()
	for key: String in overlay:
		var k := key.replace("-", "_")
		if not KEYS.has(k):
			continue
		var v: Variant = overlay[key]
		if KEYS[k] == TYPE_BOOL:
			if v is bool:
				out[k] = v
			elif v is String:
				out[k] = (v as String).to_lower() in ["1", "true", "yes", "on"]
		elif KEYS[k] == TYPE_FLOAT:
			# A number, or a string that is one, and never negative; else ignored.
			if (v is float or v is int) and float(v) >= 0.0:
				out[k] = float(v)
			elif v is String and (v as String).strip_edges().is_valid_float() and float(v) >= 0.0:
				out[k] = float(v)
		elif v is String or v is float or v is int:
			var s := str(v).strip_edges()
			if s != "":
				out[k] = s
	return out


## Command-line user args (`OS.get_cmdline_user_args()`) as an overlay.
## A flag with no value (`--offline`) is `true`.
static func parse_args(args: PackedStringArray) -> Dictionary:
	var out := {}
	var i := 0
	while i < args.size():
		var a := args[i]
		i += 1
		if not a.begins_with("--"):
			continue
		var key := a.substr(2)
		var value: Variant = true
		var eq := key.find("=")
		if eq >= 0:
			value = key.substr(eq + 1)
			key = key.substr(0, eq)
		elif i < args.size() and not args[i].begins_with("--"):
			value = args[i]
			i += 1
		key = key.replace("-", "_")
		if not KEYS.has(key):
			continue
		if KEYS[key] == TYPE_BOOL and value is String:
			value = (value as String).to_lower() in ["1", "true", "yes", "on"]
		elif KEYS[key] == TYPE_FLOAT:
			if not (value is String and (value as String).is_valid_float()) or float(value) < 0.0:
				continue
			value = float(value)
		out[key] = value
	return out


## A JSON object file as an overlay (`{}` when missing or malformed).
static func read_file(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed if parsed is Dictionary else {}


## Defaults ← each file in order ← the args.
static func resolve(files: Array, args: PackedStringArray) -> Dictionary:
	var cfg := defaults()
	for path: String in files:
		cfg = merge(cfg, read_file(path))
	return merge(cfg, parse_args(args))


## The station's configuration from the real sources.
static func load_station() -> Dictionary:
	return resolve([RES_PATH, USER_PATH], OS.get_cmdline_user_args())


## Whether the station can dial the server (a real passcode and a URL).
static func is_configured(cfg: Dictionary) -> bool:
	var code := str(cfg.get("code", ""))
	return code != "" and code != PLACEHOLDER_CODE and parse_url(str(cfg.get("server", ""))) != {}


## `http[s]://host[:port][/path]` → `{tls, host, port, base}` (`base` without a
## trailing slash), or `{}` when it isn't one.
static func parse_url(url: String) -> Dictionary:
	var u := url.strip_edges()
	var tls := false
	if u.begins_with("https://"):
		tls = true
		u = u.substr(8)
	elif u.begins_with("http://"):
		u = u.substr(7)
	else:
		return {}
	var slash := u.find("/")
	var hostport := u if slash < 0 else u.substr(0, slash)
	var path := "" if slash < 0 else u.substr(slash).rstrip("/")
	if hostport == "":
		return {}
	var port := 443 if tls else 80
	var host := hostport
	var colon := hostport.rfind(":")
	if colon >= 0:
		var p := hostport.substr(colon + 1)
		if not p.is_valid_int():
			return {}
		port = p.to_int()
		host = hostport.substr(0, colon)
	if host == "":
		return {}
	var origin := ("https://" if tls else "http://") + hostport
	return {"tls": tls, "host": host, "port": port, "path": path, "base": origin + path}


# --- the build stamp (wave 26, R8) ---------------------------------------------


## Where `tools/quest.sh build` stamps the APK it builds (in its staging
## copy only — never the working tree): `{"build": "<short sha>", "at": "<UTC>"}`.
const BUILD_PATH := "res://config/build.json"


## The lobby's build line: "build <sha> · <when>" from the stamp, or
## "build dev" for an editor / desktop run (no stamp).
static func build_stamp(path := BUILD_PATH) -> String:
	var b := read_file(path)
	var sha := str(b.get("build", "")).strip_edges()
	if sha == "":
		return "build dev"
	var at := str(b.get("at", "")).strip_edges()
	return "build %s · %s" % [sha, at] if at != "" else "build %s" % sha


# --- the user file (in-headset setup) -----------------------------------------


## The server a desktop / editor run may also offer: the event server on
## this computer (`pnpm dev`, a scratch server).
const LOCAL_SERVER := "http://127.0.0.1:7000"
## The station name a fresh setup starts with.
const DEFAULT_NAME := "Headset"


## Write `values` (known keys only, well typed) over what `path` already
## holds; true when it was written. The in-headset setup saves the server,
## passcode, name and station here — never under `res://`.
static func save_user(values: Dictionary, path := USER_PATH) -> bool:
	var cur := {}
	var file := read_file(path)
	for key: String in file:
		if KEYS.has(key):
			cur[key] = file[key]
	var keep := merge(cur, values)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(JSON.stringify(keep, "  "))
	f.close()
	return true


## Delete the user file (⚙ *Forget this setup*); true when there was one.
static func forget_user(path := USER_PATH) -> bool:
	if not FileAccess.file_exists(path):
		return false
	return DirAccess.remove_absolute(path) == OK


## A station id for a headset set up in the headset: `vr-<name>-<4 hex>`,
## so two headsets both called "Headset" never share a station (a parked
## program would go to whichever polled first).
static func station_id_for(name: String, salt: int) -> String:
	var slug := ""
	for ch in name.to_lower():
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			slug += ch
		elif not slug.ends_with("-") and slug != "":
			slug += "-"
	slug = slug.trim_suffix("-").left(24)
	if slug == "":
		slug = "headset"
	return "vr-%s-%04x" % [slug, salt & 0xffff]


## Whether this run may offer [constant LOCAL_SERVER]: an editor / CLI run,
## or any desktop — never a headset build.
static func offers_local() -> bool:
	return OS.has_feature("editor_runtime") or OS.get_name() != "Android"


## The servers the SET UP panel offers, `[{url, label}]`, first = the
## default: `current` (what the config says) when it is a URL, the
## committed `res://` server, and [constant LOCAL_SERVER] when `local` —
## first of all when `prefer_local` (an editor run naming no server of its
## own: it tests against `pnpm dev`).
static func server_choices(current: String, committed: String, local: bool, prefer_local := false) -> Array:
	var out: Array = []
	var seen := {}
	var order: Array = [current, committed, LOCAL_SERVER if local else ""]
	if local and prefer_local:
		order = [LOCAL_SERVER, current, committed]
	for url: String in order:
		var u := parse_url(url)
		if u.is_empty() or seen.has(u["base"]):
			continue
		seen[u["base"]] = true
		var bare := str(u["base"]).trim_prefix("https://").trim_prefix("http://")
		var label := "This computer · %s" % bare if u["base"] == LOCAL_SERVER else bare
		out.append({"url": u["base"], "label": label})
	return out
