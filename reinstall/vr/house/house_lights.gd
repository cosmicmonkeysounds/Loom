## The house lights in the game (wave 39, `docs/loom-w39-contract.md` C5) —
## a port of `house/src/lights-presence.ts`: [method game_lights_of]
## (`gameLightsOf`, the spatial stream's `lights` frame off the wire) and
## [method pulse_factor] (`pulseFactor`, the games' pulse curve), literal.
##
## Plus the pure rules the house's lamps ([HouseLamps]) draw by: what a
## fixture shows at a moment ([method shown_level]), which floor it hangs on
## ([method light_floor]), which lit fixtures get the fixed pool of real
## lights ([method pick_pool]), how dark the ambient goes while the real
## house drives the scene ([method ambient]), and the graphics tiers
## ([method tier_of], [method pool_size]).
class_name HouseLights
extends RefCounted

## `LIGHT_KINDS` (`house/src/lights.ts`).
const KINDS := ["zigbee", "zigbee-group", "wled"]
## `LIGHT_EFFECTS`.
const EFFECTS := ["blink", "breathe", "okay", "channel_change", "finish_effect", "stop_effect"]
## `LIGHT_PRESENCE_EFFECTS`.
const PRESENCE_EFFECTS := ["breathe", "blink", "okay"]
## `LAMP_SETTLED.color` (`house/src/look-preview.ts`): a light with no
## (readable) colour shows this warm white.
const SETTLED_COLOR := "#ffd9a8"

## The graphics tiers (`station.json` `graphics`), cheapest first.
const TIERS := ["low", "medium", "high"]
const DEFAULT_TIER := "medium"
## Real [OmniLight3D]s per tier: a fixed pool, never resized while running.
## The Mobile renderer lights a mesh with at most 8 omni lights; the duck,
## the heart and the disk carry one each.
const POOL := {"low": 2, "medium": 4, "high": 6}
## A fixture this dim (shown level) or darker gets no real light.
const LIT_MIN := 0.02

## The ambient light without a `lights` frame (today's house) and the
## night floor it dims toward while frames arrive. The floor keeps the
## checkerboards and the walls readable: the duck hunt never suffers.
const DAY_AMBIENT := 0.55
const DAY_SUN := 0.7
const NIGHT_AMBIENT := 0.24
const NIGHT_SUN := 0.22
## How much of the way back to the day a fully lit house brings the
## ambient, and how far its mean colour tints it.
const LIT_LIFT := 0.4
const TINT := 0.3
const DAY_COLOR := Color("#9fd8e0")


## A `lights` frame (`GameLights`) off the wire, or `null` when it isn't
## one; a malformed light is dropped, not the frame. `{at, source: "house"
## | "estimate", pulse: "breathe" | "blink" | "okay" | null, lights: [{id,
## room, pos: {x, y, z}, kind, color: "#rrggbb", level: 0..1, effect,
## pulse, safety}]}`.
static func game_lights_of(raw: Variant) -> Variant:
	if not raw is Dictionary:
		return null
	var r: Dictionary = raw
	if not r.get("lights") is Array:
		return null
	var lights: Array = []
	for l: Variant in r["lights"]:
		if not l is Dictionary:
			continue
		var o: Dictionary = l
		var pos: Variant = o.get("pos")
		if not o.get("id") is String or not pos is Dictionary:
			continue
		var x: Variant = (pos as Dictionary).get("x")
		var y: Variant = (pos as Dictionary).get("y")
		var z: Variant = (pos as Dictionary).get("z")
		if not (_finite(x) and _finite(y) and _finite(z)):
			continue
		var level := clampf(float(o["level"]), 0.0, 1.0) if _finite(o.get("level")) else 0.0
		var color: Variant = o.get("color")
		lights.append({
			"id": o["id"],
			"room": o["room"] if o.get("room") is String else "",
			"pos": {"x": float(x), "y": float(y), "z": float(z)},
			"kind": o["kind"] if KINDS.has(o.get("kind")) else "zigbee",
			"color": (color as String).to_lower() if color is String and _hex(color) else SETTLED_COLOR,
			"level": level,
			"effect": o["effect"] if EFFECTS.has(o.get("effect")) else null,
			"pulse": o.get("pulse") is bool and o["pulse"] == true,
			"safety": o.get("safety") is bool and o["safety"] == true,
		})
	var pulse: Variant = r.get("pulse")
	return {
		"at": float(r["at"]) if r.get("at") is float or r.get("at") is int else 0.0,
		"source": "house" if r.get("source") is String and r["source"] == "house" else "estimate",
		"pulse": pulse if pulse is String and PRESENCE_EFFECTS.has(pulse) else null,
		"lights": lights,
	}


## A JSON number that is finite (`typeof v === "number" && isFinite(v)`).
static func _finite(v: Variant) -> bool:
	return (v is float or v is int) and is_finite(float(v))


## `#rrggbb`, either case (`/^#[0-9a-f]{6}$/i`).
static func _hex(s: String) -> bool:
	if s.length() != 7 or not s.begins_with("#"):
		return false
	for ch in s.substr(1):
		if not "0123456789abcdefABCDEF".contains(ch):
			return false
	return true


## The pulse's brightness factor `t` seconds into it: 1 → 0.35 → 1, one
## breath per `period` s (`pulseFactor`).
static func pulse_factor(t: float, period := 2.0) -> float:
	var phase := fposmod(fposmod(t / period, 1.0) + 1.0, 1.0)
	return 0.35 + 0.65 * (0.5 + 0.5 * cos(phase * PI * 2.0))


## What a fixture shows `t` seconds into its pulse: its level, times
## [method pulse_factor] while a program is under it. A dark fixture stays
## dark (a breathe on a bulb that is off does nothing).
static func shown_level(light: Dictionary, t: float) -> float:
	var level := float(light.get("level", 0.0))
	return level * pulse_factor(t) if light.get("pulse", false) == true else level


## The floor a fixture hangs on: its room's, else the floor its height is on.
static func light_floor(house: Dictionary, light: Dictionary) -> String:
	var room: Variant = HouseGeometry.room_by_id(house, light.get("room", ""))
	if room != null:
		return str(room["floor"])
	return HouseLocate.floor_of(house, float((light["pos"] as Dictionary)["y"]))


## The fixture's position as a house `[x, y, z]`.
static func pos_of(light: Dictionary) -> Array:
	var p: Dictionary = light["pos"]
	return [float(p["x"]), float(p["y"]), float(p["z"])]


## The ids of at most `n` lit fixtures (level > [constant LIT_MIN]) on
## `floor_id`, nearest to `at` (house `[x, y, z]`) first (ties: file
## order). A floor-less player (`""`) gets none.
static func pick_pool(lights: Array, house: Dictionary, floor_id: String, at: Array, n: int) -> Array:
	if floor_id == "" or n <= 0:
		return []
	var near: Array = []
	for i in lights.size():
		var l: Dictionary = lights[i]
		if float(l.get("level", 0.0)) <= LIT_MIN or light_floor(house, l) != floor_id:
			continue
		var p := pos_of(l)
		var d := Vector3(p[0] - float(at[0]), p[1] - float(at[1]), p[2] - float(at[2])).length()
		near.append([d, i, str(l["id"])])
	near.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	var out: Array = []
	for e: Array in near.slice(0, n):
		out.append(e[2])
	return out


## The ambient light for a frame: `{energy, sun, color}`. No frame (`{}`:
## an old server, no lights module, or none yet) is today's house; with
## one the ambient drops to the night floor, lifted back part of the way
## and tinted by how bright the real house is (its fixtures' mean level
## and their level-weighted colour).
static func ambient(frame: Dictionary) -> Dictionary:
	if frame.is_empty():
		return {"energy": DAY_AMBIENT, "sun": DAY_SUN, "color": DAY_COLOR}
	var lights: Array = frame.get("lights", [])
	var sum := 0.0
	var mix := Color(0, 0, 0)
	for l: Dictionary in lights:
		var lv := float(l.get("level", 0.0))
		sum += lv
		var c := Color(str(l.get("color", SETTLED_COLOR)))
		mix += Color(c.r * lv, c.g * lv, c.b * lv)
	var mean := sum / lights.size() if not lights.is_empty() else 0.0
	var lift := LIT_LIFT * mean
	var color := DAY_COLOR
	if sum > 0.0:
		color = DAY_COLOR.lerp(Color(mix.r / sum, mix.g / sum, mix.b / sum), TINT * mean)
	return {
		"energy": lerpf(NIGHT_AMBIENT, DAY_AMBIENT, lift),
		"sun": lerpf(NIGHT_SUN, DAY_SUN, lift),
		"color": color,
	}


## A graphics tier from a config value: `low`, `medium` or `high`
## (any case), else [constant DEFAULT_TIER].
static func tier_of(v: Variant) -> String:
	var s := str(v).strip_edges().to_lower() if v is String else ""
	return s if TIERS.has(s) else DEFAULT_TIER


## The real lights in the pool for a tier.
static func pool_size(tier: String) -> int:
	return int(POOL.get(tier_of(tier), POOL[DEFAULT_TIER]))
