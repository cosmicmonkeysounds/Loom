## Game moments on props (wave 26, C6) — a literal port of
## `house/src/moment.ts`: Trabolta's heart ([method heart_reached], a
## `heart` prop) and a pickup ([method pickup_reach], a `pickup` prop, the
## virus disk). The game posts `POST /api/spatial/moment` only when these
## say so; the server judges the session's last pose the same way (a pickup
## with [constant PICKUP_SLACK_M]). Pinned by
## `res://test/golden/<map>.moments.json` and `constants.json`.
class_name HouseMoment
extends RefCounted

## The story signal a heart posts when its prop names none (`signals.reached`).
const HEART_SIGNAL := "simulation heart reached"
## The story signal a pickup posts when its prop names none (`signals.taken`).
const PICKUP_SIGNAL := "simulation pickup taken"
## "Reached": the feet this far (plan) inside the heart's room.
const HEART_INSET_M := 0.3
## A pickup is in reach within this plan distance of its `pos`, on its floor.
const PICKUP_REACH_M := 0.9
## The server's extra pickup reach.
const PICKUP_SLACK_M := 0.3


## [method HouseLocate.locate] puts `feet` in the heart's room, at least
## [constant HEART_INSET_M] (plan) inside its polygon.
static func heart_reached(house: Dictionary, feet: Array, heart: Dictionary) -> bool:
	var at: Variant = HouseLocate.locate(house, feet)["room"]
	if at == null or str(at) != str(heart.get("room", "")):
		return false
	var room: Variant = HouseGeometry.room_by_id(house, heart["room"])
	if room == null:
		return false
	var plan := [float(feet[0]), float(feet[2])]
	return HouseGeometry.point_in_poly(room["poly"], plan) and HouseGeometry.distance_to_boundary(room["poly"], plan) >= HEART_INSET_M - 1e-9


## On the pickup's floor, within [constant HouseDuck.DUCK_MAX_RISE] of it in
## height, and within [constant PICKUP_REACH_M] + `slack` of its base centre in plan.
static func pickup_reach(house: Dictionary, feet: Array, prop: Dictionary, slack: float = 0.0) -> bool:
	var pos: Array = prop["pos"]
	if HouseLocate.floor_of(house, float(feet[1])) != HouseLocate.floor_of(house, float(pos[1])):
		return false
	if absf(float(pos[1]) - float(feet[1])) > HouseDuck.DUCK_MAX_RISE + 1e-9:
		return false
	var dx := float(pos[0]) - float(feet[0])
	var dz := float(pos[2]) - float(feet[2])
	return sqrt(dx * dx + dz * dz) <= PICKUP_REACH_M + slack + 1e-9


## The prop `id` when it is of `kind` ("heart" | "pickup"), else `{}`.
static func moment_prop(house: Dictionary, id: String, kind: String) -> Dictionary:
	for p: Dictionary in house.get("props", []):
		if str(p.get("id", "")) == id:
			return p if str(p.get("kind", "")) == kind else {}
	return {}


## Every prop of `kind`, in map order.
static func props_of(house: Dictionary, kind: String) -> Array:
	return house.get("props", []).filter(func(p: Dictionary) -> bool: return str(p.get("kind", "")) == kind)


## The story signal a moment on `prop` posts: a heart's `signals.reached`,
## a pickup's `signals.taken`, else the kind's default; "" for other kinds.
static func prop_signal(prop: Dictionary) -> String:
	var kind := str(prop.get("kind", ""))
	var key := "reached" if kind == "heart" else ("taken" if kind == "pickup" else "")
	if key == "":
		return ""
	var signals: Variant = prop.get("signals")
	if signals is Dictionary and (signals as Dictionary).get(key) is String and str(signals[key]).strip_edges() != "":
		return str(signals[key])
	return HEART_SIGNAL if kind == "heart" else PICKUP_SIGNAL
