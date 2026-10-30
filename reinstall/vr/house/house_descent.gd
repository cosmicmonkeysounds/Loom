## The descent (wave 49, `docs/loom-w49-contract.md`) — the literal port of
## `house/src/descent.ts`, diffed against `res://test/golden/descent.json`:
## the level a walk runs at, its seeded plan of visions, which props are
## awake, and how a talker's dialogue walks. What a vision looks like is the
## game's ([Descent], [Hallway], [TalkPanel]); nothing here touches the
## server's judgement.
##
## The words live in the show's `descent.json` (a project file served live,
## [method LinkBase.fetch_descent]); `res://house/descent.json`, a copy
## written by `pnpm house:sync`, is the fallback ([method bundled]). A level
## with no script still plays its visions.
class_name HouseDescent
extends RefCounted

## The project file's name.
const DESCENT_FILE := "descent.json"
## The deepest level; every reinstall past it stays here.
const DESCENT_MAX := 4
## The copy `pnpm house:sync` writes (never edited here).
const BUNDLED := "res://house/descent.json"

## The things that can happen to a program, mildest first.
const VISION_KINDS := ["flicker", "follower", "whisper", "tint", "whiteduck", "grin", "dark", "self", "small", "big", "door"]
## The level a vision first happens at.
const VISION_FROM := {"flicker": 1, "follower": 1, "whisper": 1, "tint": 2, "whiteduck": 2, "grin": 2, "dark": 3, "self": 3, "small": 3, "big": 3, "door": 3}
## How long a vision holds (s). `door` is how long it waits to be walked through.
const VISION_S := {"flicker": 2.5, "follower": 7.0, "whisper": 5.0, "tint": 9.0, "whiteduck": 6.0, "grin": 8.0, "dark": 11.0, "self": 9.0, "small": 22.0, "big": 18.0, "door": 30.0}

## Seconds into a walk of the first vision, per level.
const DESCENT_FIRST_S := [0.0, 25.0, 18.0, 12.0, 8.0]
## The mean gap between visions, per level (s; each is 0.65–1.35 of it).
const DESCENT_GAP_S := [0.0, 70.0, 48.0, 34.0, 22.0]
## How far a plan reaches (s). A walk is rarely half this.
const DESCENT_PLAN_S := 900.0
## A vision that could not run for this long (s) is dropped, not saved up.
const DESCENT_LATE_S := 20.0
## Props awake per level.
const TALKERS_AWAKE := [0, 1, 2, 3, 5]

## A talker speaks to a program within this plan distance of its edge (m).
const TALK_NEAR_M := 1.8
## Further than this and it gives up on them (m).
const TALK_LEAVE_M := 3.0
## The most options a node may offer.
const TALK_OPTIONS_MAX := 4
## The longest option (the headset's panel fits it).
const TALK_OPTION_CHARS := 48
## The longest line of speech.
const TALK_LINE_CHARS := 160
## `Prop.talk` for a prop that never talks.
const TALK_NONE := "none"

## The corridor's width and height (m).
const HALLWAY_WIDTH_M := 1.3
const HALLWAY_HEIGHT_M := 2.3
## How far away the far door stands when you enter (m).
const HALLWAY_FAR_M := 14.0
## The far door backs away for this long (s), then lets you reach it.
const HALLWAY_RETREAT_S := 22.0
## It backs away at this fraction of your own pace.
const HALLWAY_RETREAT := 0.92
## Nobody is in there longer than this (s): the house lets them go.
const HALLWAY_MAX_S := 70.0
## Walking within this of a door goes through it (m).
const HALLWAY_DOOR_M := 0.7

## The `door` vision stands this far from the program (m).
const DOOR_AHEAD_M := 3.0

## Small / big: the eye height scales by this, over [constant ALICE_EASE_S].
const ALICE_SMALL := 0.32
const ALICE_BIG := 1.42
const ALICE_EASE_S := 4.0

const LOOKS := [
	{"fog": 1.0, "ambient": 1.0, "flicker": 1.0, "tint": "#ffffff", "tintBy": 0.0},
	{"fog": 1.15, "ambient": 0.92, "flicker": 1.25, "tint": "#b8a6ff", "tintBy": 0.06},
	{"fog": 1.35, "ambient": 0.82, "flicker": 1.7, "tint": "#ff9ad5", "tintBy": 0.1},
	{"fog": 1.6, "ambient": 0.7, "flicker": 2.2, "tint": "#ff5a6e", "tintBy": 0.14},
	{"fog": 2.0, "ambient": 0.58, "flicker": 3.3, "tint": "#8aff9a", "tintBy": 0.18},
]

const NTH := ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"]

static var _bundled: Variant = null
static var _bundled_read := false


## The clamped level (a whole number, 0 … [constant DESCENT_MAX]; junk reads 0).
static func clamp_descent(level: Variant) -> int:
	if not (level is int or level is float):
		return 0
	var v := float(level)
	if is_nan(v) or is_inf(v):
		return 0
	return maxi(0, mini(DESCENT_MAX, floori(v)))


## The level of a walk by the reinstalls behind it: the first walk is clean.
static func descent_level(reinstalled: Variant) -> int:
	return clamp_descent(reinstalled)


## A walk's level: the server's word (`descent`), else its `reinstalled`.
static func descent_of(a: Dictionary) -> int:
	var d: Variant = a.get("descent")
	return clamp_descent(d) if d is int or d is float else descent_level(a.get("reinstalled"))


## The steady wrongness of a level, always on: `fog` and `ambient` multiply
## the game's own; `flicker` divides the neon's stutter period; `tint` is
## mixed into the light by `tintBy`.
static func descent_look(level: int) -> Dictionary:
	return LOOKS[clamp_descent(level)]


static func _shuffled(pool: Array, seed: String) -> Array:
	var a := pool.duplicate()
	for i in range(a.size() - 1, 0, -1):
		var j := HouseDuck.fnv1a32("%s/s%d" % [seed, i]) % (i + 1)
		var t: Variant = a[i]
		a[i] = a[j]
		a[j] = t
	return a


## A walk's visions (`[{at, vision, n}]`, `n` picks among its lines and
## sides), in order, deterministic per seed (the session id). Every kind its
## level allows comes up once before any repeats; `door` comes up once only,
## and from level 3 it is always the third.
static func descent_plan(seed: String, level: int) -> Array:
	var l := clamp_descent(level)
	if l == 0:
		return []
	var pool: Array = VISION_KINDS.filter(func(k: String) -> bool: return int(VISION_FROM[k]) <= l)
	var order := _shuffled(pool, seed)
	var door := order.find("door")
	if door >= 0:
		var swap := mini(2, order.size() - 1)
		order[door] = order[swap]
		order[swap] = "door"
	var out: Array = []
	var t: float = DESCENT_FIRST_S[l]
	var turn := 0
	var i := 0
	var door_done := false
	while t < DESCENT_PLAN_S:
		var vision: String = order[turn % order.size()]
		turn += 1
		if vision == "door" and door_done:
			vision = order[turn % order.size()]
			turn += 1
		if vision == "door":
			door_done = true
		var h := HouseDuck.fnv1a32("%s:%d" % [seed, i])
		out.append({"at": t, "vision": vision, "n": h % 1024})
		var jitter := 0.65 + float((h >> 10) % 701) / 1000.0
		t = floor((t + float(DESCENT_GAP_S[l]) * jitter) * 10.0 + 0.5) / 10.0
		i += 1
	return out


## The next beat to play at `t` s. `from` is the first beat not yet spent.
## Answers its index, or -1 while none is due. A beat
## [constant DESCENT_LATE_S] overdue is passed over (it was held off too
## long, by a talk or a King).
static func due_beat(plan: Array, from: int, t: float) -> int:
	for i in range(from, plan.size()):
		var at := float(plan[i]["at"])
		if at > t:
			return -1
		if t - at <= DESCENT_LATE_S:
			return i
	return -1


# --- the script (`descent.json`) -----------------------------------------------


static func _is_text(v: Variant) -> bool:
	return v is String and (v as String).strip_edges() != ""


static func _is_id(v: Variant) -> bool:
	if not v is String:
		return false
	var s: String = v
	if s.length() < 1 or s.length() > 32 or s[0] < "a" or s[0] > "z":
		return false
	for c in s:
		if not ((c >= "a" and c <= "z") or (c >= "0" and c <= "9") or c == "-"):
			return false
	return true


static func _lines(problems: Array, at: String, v: Variant) -> void:
	if not v is Array or not (v as Array).all(_is_text):
		problems.append("%s must be a list of lines" % at)
		return
	for l: String in v:
		if l.length() > TALK_LINE_CHARS:
			problems.append("%s: a line over %d characters" % [at, TALK_LINE_CHARS])


static func _levels(problems: Array, at: String, v: Variant) -> void:
	if not v is Dictionary:
		problems.append("%s must be an object of levels" % at)
		return
	for k: String in v:
		if not k in ["1", "2", "3", "4"]:
			problems.append("%s.%s: a level is 1–%d" % [at, k, DESCENT_MAX])
		_lines(problems, "%s.%s" % [at, k], v[k])


static func _vision(problems: Array, at: String, v: Variant) -> void:
	if v != null and not VISION_KINDS.has(v):
		problems.append("%s: \"%s\" is not a vision" % [at, str(v)])


## Is `raw` a usable `descent.json`? `{ok, problems, warnings}`.
static func validate_descent(raw: Variant) -> Dictionary:
	var problems: Array = []
	var warnings: Array = []
	var done := func() -> Dictionary: return {"ok": problems.is_empty(), "problems": problems, "warnings": warnings}
	if not raw is Dictionary:
		problems.append("descent.json must be an object")
		return done.call()
	var r: Dictionary = raw
	var version: Variant = r.get("version")
	if not (version is int or version is float) or float(version) != 1.0:
		problems.append("version must be 1")
	_levels(problems, "whispers", r.get("whispers"))
	_levels(problems, "found", r.get("found"))
	for k: String in ["grin", "whiteduck", "self", "small", "big"]:
		_lines(problems, k, r.get(k))
	var hallway: Variant = r.get("hallway")
	if not hallway is Dictionary:
		problems.append("hallway must be an object {enter, far, out}")
	else:
		for k: String in ["enter", "far", "out"]:
			_lines(problems, "hallway.%s" % k, hallway.get(k))
	var talkers: Variant = r.get("talkers")
	if not talkers is Array:
		problems.append("talkers must be a list")
		return done.call()
	var ids := {}
	for i in (talkers as Array).size():
		var t: Variant = talkers[i]
		var at := "talkers[%d]" % i
		if not t is Dictionary:
			problems.append("%s must be an object" % at)
			continue
		var id: Variant = t.get("id")
		if not _is_id(id) or id == TALK_NONE:
			problems.append("%s: id must be a talker id" % at)
		elif ids.has(id):
			problems.append("%s: id \"%s\" is used twice" % [at, id])
		else:
			ids[id] = true
		var who := "talker \"%s\"" % id if id is String else at
		var from: Variant = t.get("from")
		if not (from is int or from is float) or float(from) != floor(float(from)) or float(from) < 1.0 or float(from) > DESCENT_MAX:
			problems.append("%s: from must be a level, 1–%d" % [who, DESCENT_MAX])
		var models: Variant = t.get("models")
		if models != null:
			if not models is Array or not (models as Array).all(func(m: Variant) -> bool: return m is String):
				problems.append("%s: models must be a list of model ids" % who)
			else:
				for m: String in models:
					if HouseModels.prop_model(m).is_empty():
						warnings.append("%s: \"%s\" is not a model yet" % [who, m])
		var nodes: Variant = t.get("nodes")
		if not nodes is Dictionary:
			problems.append("%s: nodes must be an object" % who)
			continue
		if not (nodes as Dictionary).has("start"):
			problems.append("%s: no \"start\" node" % who)
		var seen := {"start": true}
		var opens: Variant = t.get("opens")
		if opens != null:
			if not opens is Array:
				problems.append("%s: opens must be a list" % who)
			else:
				for o: Variant in opens:
					if not o is Dictionary or not o.get("node") is String:
						problems.append("%s: an opens entry needs a node" % who)
						continue
					seen[o["node"]] = true
					if not (nodes as Dictionary).has(o["node"]):
						problems.append("%s: opens names no node \"%s\"" % [who, o["node"]])
		for name: String in nodes:
			var nat := "%s node \"%s\"" % [who, name]
			var n: Variant = nodes[name]
			if not n is Dictionary:
				problems.append("%s must be an object" % nat)
				continue
			_lines(problems, "%s say" % nat, n.get("say"))
			_vision(problems, "%s do" % nat, n.get("do"))
			var options: Variant = n.get("options")
			if options == null:
				continue
			if not options is Array or (options as Array).is_empty():
				problems.append("%s: options must be a non-empty list" % nat)
				continue
			if (options as Array).size() > TALK_OPTIONS_MAX:
				problems.append("%s: more than %d options" % [nat, TALK_OPTIONS_MAX])
			for k in (options as Array).size():
				var o: Variant = options[k]
				var oat := "%s option %d" % [nat, k + 1]
				if not o is Dictionary or not _is_text(o.get("text")):
					problems.append("%s: needs text" % oat)
					continue
				if str(o["text"]).length() > TALK_OPTION_CHARS:
					problems.append("%s: over %d characters" % [oat, TALK_OPTION_CHARS])
				var to: Variant = o.get("to")
				if to != null:
					if not to is String or not (nodes as Dictionary).has(to):
						problems.append("%s: goes to no node \"%s\"" % [oat, str(to)])
					else:
						seen[to] = true
				if o.get("tell") != null and not _is_text(o.get("tell")):
					problems.append("%s: tell must be a mark" % oat)
				_vision(problems, "%s do" % oat, o.get("do"))
		for name: String in nodes:
			if not seen.has(name):
				warnings.append("%s: node \"%s\" is never reached" % [who, name])
	return done.call()


## The script in `raw`, or null when it doesn't validate.
static func parse_descent(raw: Variant) -> Variant:
	return raw if bool(validate_descent(raw)["ok"]) else null


## `res://house/descent.json`, the fallback for a server with no script
## (null when it is missing or broken). Read once.
static func bundled() -> Variant:
	if not _bundled_read:
		_bundled_read = true
		if FileAccess.file_exists(BUNDLED):
			_bundled = parse_descent(JSON.parse_string(FileAccess.get_file_as_string(BUNDLED)))
	return _bundled


## The talker a prop speaks through, or null.
static func talker_for(script: Dictionary, prop: Dictionary) -> Variant:
	var talk: Variant = prop.get("talk")
	if talk == TALK_NONE:
		return null
	if talk != null:
		for t: Dictionary in script["talkers"]:
			if t["id"] == talk:
				return t
		return null
	if prop.get("model") == null:
		return null
	for t: Dictionary in script["talkers"]:
		if t.get("models") is Array and (t["models"] as Array).has(prop["model"]):
			return t
	return null


## Who is awake on this walk (`[{prop, talker}]`): up to
## [constant TALKERS_AWAKE]`[level]` props, one per talker, in as many rooms
## as it can, `first` talkers ahead of the rest, in an order seeded by the
## session. A prop not there yet (`from`) never wakes.
static func wake_talkers(house: Dictionary, script: Variant, level: int, seed: String) -> Array:
	var l := clamp_descent(level)
	if not script is Dictionary or l == 0:
		return []
	var rows: Array = []
	for prop: Dictionary in house.get("props", []):
		if (float(prop["from"]) if prop.get("from") != null else 0.0) > l:
			continue
		var talker: Variant = talker_for(script, prop)
		if talker == null or float(talker["from"]) > l:
			continue
		rows.append({"prop": prop, "talker": talker, "key": HouseDuck.fnv1a32("%s:%s" % [seed, prop["id"]])})
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var fa := 0 if a["talker"].get("first") == true else 1
		var fb := 0 if b["talker"].get("first") == true else 1
		if fa != fb:
			return fa < fb
		if a["key"] != b["key"]:
			return a["key"] < b["key"]
		return str(a["prop"]["id"]) < str(b["prop"]["id"]))
	var want: int = TALKERS_AWAKE[l]
	var out: Array = []
	var talkers := {}
	var rooms := {}
	for pass_n: int in [0, 1]:
		for r: Dictionary in rows:
			if out.size() >= want:
				return out
			var tid := str(r["talker"]["id"])
			var room := str(r["prop"]["room"])
			if talkers.has(tid) or (pass_n == 0 and rooms.has(room)):
				continue
			talkers[tid] = true
			rooms[room] = true
			out.append({"prop": str(r["prop"]["id"]), "talker": tid})
	return out


## Is a program with its feet at `feet` within `radius` (plan, from the
## prop's edge) of `prop`, on its floor?
static func talk_reach(house: Dictionary, feet: Array, prop: Dictionary, radius := TALK_NEAR_M) -> bool:
	var pos: Array = prop["pos"]
	var size: Array = prop["size"]
	if HouseLocate.floor_of(house, float(feet[1])) != HouseLocate.floor_of(house, float(pos[1])):
		return false
	var reach := radius + maxf(float(size[0]), float(size[2])) / 2.0
	return Vector2(float(pos[0]) - float(feet[0]), float(pos[2]) - float(feet[2])).length() <= reach + 1e-9


## Where a talker's face sits, in the house frame (`{pos, yaw}`): on the
## prop's front, two thirds up; `yaw` the way the prop faces.
static func face_anchor(prop: Dictionary) -> Dictionary:
	var yaw := float(prop["yaw"]) if prop.get("yaw") != null else 0.0
	var a := deg_to_rad(yaw)
	var pos: Array = prop["pos"]
	var size: Array = prop["size"]
	var out := float(size[2]) / 2.0 + 0.02
	return {"pos": [float(pos[0]) - sin(a) * out, float(pos[1]) + float(size[1]) * 0.68, float(pos[2]) - cos(a) * out], "yaw": yaw}


## Where the Hallway's door turns up (`{pos, yaw}`):
## [constant DOOR_AHEAD_M] ahead of a program at `feet` looking along `yaw`,
## in the room it is in, turned to face it; else off to a side, else behind
## it. Null when nowhere fits: the vision is skipped.
static func door_spot(house: Dictionary, feet: Array, yaw: float) -> Variant:
	var room: Variant = HouseLocate.locate(house, feet)["room"]
	if room == null:
		return null
	for turn: float in [0.0, 40.0, -40.0, 90.0, -90.0, 180.0]:
		var a := deg_to_rad(yaw + turn)
		var pos: Array = [float(feet[0]) - sin(a) * DOOR_AHEAD_M, float(feet[1]), float(feet[2]) - cos(a) * DOOR_AHEAD_M]
		if HouseLocate.locate(house, pos)["room"] == room and HouseLocate.standable(house, pos):
			return {"pos": pos, "yaw": HouseFrames.wrap_yaw(yaw + turn + 180.0)}
	return null


## The node a talk with `talker` starts at, given what was told so far.
static func open_node(talker: Dictionary, told: Variant) -> String:
	var opens: Variant = talker.get("opens")
	if opens is Array:
		for o: Dictionary in opens:
			var need: Dictionary = o["told"] if o.get("told") is Dictionary else {}
			var ok := true
			for k: String in need:
				var have: Variant = (told as Dictionary).get(k) if told is Dictionary else null
				if typeof(have) != typeof(need[k]) or have != need[k]:
					ok = false
					break
			if ok:
				return str(o["node"])
	return "start"


## What picking option `index` on `node` does (`{to, tell, vision}`, each
## null when absent), or null when there is no such option.
static func pick_option(talker: Dictionary, node: String, index: int) -> Variant:
	var n: Variant = talker["nodes"].get(node)
	if not n is Dictionary or not n.get("options") is Array:
		return null
	var options: Array = n["options"]
	if index < 0 or index >= options.size():
		return null
	var o: Dictionary = options[index]
	return {"to": o.get("to"), "tell": o.get("tell"), "vision": o.get("do")}


## "fourth" (12 and under), else "13th".
static func ordinal(n: int) -> String:
	return NTH[n] if n >= 0 and n < NTH.size() else "%dth" % n


## A walk's number for the lines (`{visit}`): the finds behind it plus this
## one, and never fewer than its level says, so a level a director forced on a
## first walk still reads as a program that has been here before.
static func visit_of(reinstalled: Variant, lvl: int) -> int:
	var n := 0
	if (reinstalled is int or reinstalled is float) and float(reinstalled) > 0.0:
		n = int(floor(float(reinstalled)))
	return maxi(n, clamp_descent(lvl)) + 1


## A line for this program (`who`: `{name, visit}`): `{name}` their name,
## `{visit}` this walk's number, `{nth}` it as a word ("fourth").
static func fill_line(text: String, who: Dictionary) -> String:
	var visit := int(who["visit"])
	return text.replace("{name}", str(who["name"])).replace("{visit}", str(visit)).replace("{nth}", ordinal(visit))


## A vision's lines at `n`: the script's list wrapped by `n`, or null.
static func pick_line(list: Variant, n: float) -> Variant:
	if not list is Array or (list as Array).is_empty():
		return null
	return list[absi(int(n)) % (list as Array).size()]
