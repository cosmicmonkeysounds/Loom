## A headset's station configuration — `docs/loom-reinstall.md` §5.
##
## Precedence, lowest first: the built-in defaults → `res://config/station.json`
## (committed, placeholders) → `user://station.json` (written on the headset
## once, e.g. with `adb push`) → the command line after `--`:
##
##   godot --path . -- --server http://10.0.0.2:7000 --code 4821 \
##         --station vr-1 --name "Headset 1" [--guest g-3f9a1c] [--offline] [--smooth-turn]
##         [--autopilot]
##
## `--autopilot` (dev / CI only) walks the trail to the duck by itself and
## quits when the session is over — see [Autopilot].
##
## `--key value` and `--key=value` both work. Pure: everything but
## [method load_station] takes its inputs as arguments, so the tests drive it.
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
