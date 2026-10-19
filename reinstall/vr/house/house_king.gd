## The King — a port of `house/src/king.ts`: the reach rule ([method
## king_reach], `kingReach`: may a program standing at `feet` (house frame)
## looking along `yaw` (degrees, 0 = north, + = counter-clockwise) land a
## hit on the `king` prop?), diffed against the `<name>.king.json` goldens.
## The server judges the same rule on the session's last pose with
## [constant KING_HIT_SLACK], so the game only posts a hit this says is
## "ok" without slack.
##
## Also the map a fallen King leaves behind ([method with_fallen_kings],
## `withFallenKings`, what `route(…, {fallen})` routes over — the
## `<name>.fallen.json` goldens): his doors lose their guard and he stops
## being solid. And the shared `KingState` off the wire.
class_name HouseKing
extends RefCounted

## Plan metres, feet → the king's base centre (the body stops ≈ 0.55 m from it).
const KING_REACH := 1.25
## |relative bearing| allowed: the player must face him.
const KING_CONE_DEG := 55.0
## A king's maximum hit points when the prop declares none.
const KING_HP := 4
## The server's slack on a hit (its pose is the session's last, a little
## behind the player): extra plan metres and degrees.
const KING_HIT_SLACK := {"reach": 0.35, "cone": 25.0}


## "ok" | "floor" (another floor) | "far" (beyond [constant KING_REACH] in
## plan) | "facing" (not within [constant KING_CONE_DEG] of him), checked
## in that order; standing on his very centre counts as facing him.
## `slack` (`{reach, cone}`) widens the reach and the cone.
static func king_reach(house: Dictionary, feet: Array, yaw: float, king: Dictionary, slack := {}) -> String:
	var pos: Array = king["pos"]
	if HouseLocate.floor_of(house, float(feet[1])) != HouseLocate.floor_of(house, float(pos[1])):
		return "floor"
	var dx := float(pos[0]) - float(feet[0])
	var dz := float(pos[2]) - float(feet[2])
	if Vector2(dx, dz).length() > KING_REACH + float(slack.get("reach", 0.0)):
		return "far"
	if dx == 0.0 and dz == 0.0:
		return "ok"
	# The yaw that faces him (§1: 0 = north / −z, counter-clockwise +).
	var toward := rad_to_deg(atan2(-dx, -dz))
	if absf(HouseFrames.wrap_yaw(toward - yaw)) > KING_CONE_DEG + float(slack.get("cone", 0.0)):
		return "facing"
	return "ok"


## The first `king` prop of the map, else `{}`.
static func king_prop(house: Dictionary) -> Dictionary:
	for prop: Dictionary in house.get("props", []):
		if str(prop.get("kind", "")) == "king":
			return prop
	return {}


## A king's maximum hit points: its `hp` (an integer ≥ 1), else [constant KING_HP].
static func king_max(king: Dictionary) -> int:
	var hp: Variant = king.get("hp")
	if (hp is float or hp is int) and float(hp) == floorf(float(hp)) and float(hp) >= 1.0:
		return int(hp)
	return KING_HP


## The map once the kings named in `fallen` (a set: id → true) are down:
## every door one of them guards loses its `guard` (open for routing, as
## for the physics), and each of those king props stops being solid. A
## copy — `house` is untouched; a set naming no king returns `house` itself.
## [method HouseRoute.route] keeps every guarded door shut (no portal
## through it); the trail and the autopilot route over this once he has
## fallen, or from behind his door (the Server Room's only one) every route
## would be the straight no-path line through a wall.
static func with_fallen_kings(house: Dictionary, fallen: Dictionary) -> Dictionary:
	var any := false
	for p: Dictionary in house.get("props", []):
		if str(p.get("kind", "")) == "king" and fallen.has(str(p.get("id", ""))):
			any = true
	if not any:
		return house
	var out := house.duplicate()
	var doors: Array = []
	for d: Dictionary in house.get("doors", []):
		if d.get("guard") != null and fallen.has(str(d["guard"])):
			var open := d.duplicate()
			open.erase("guard")
			doors.append(open)
		else:
			doors.append(d)
	var props: Array = []
	for p: Dictionary in house.get("props", []):
		if str(p.get("kind", "")) == "king" and fallen.has(str(p.get("id", ""))):
			var down := p.duplicate()
			down["solid"] = false
			props.append(down)
		else:
			props.append(p)
	out["doors"] = doors
	out["props"] = props
	return out


## The map the trail routes over: `house` with king `king`'s doors open
## while `fallen` ([method with_fallen_kings]); standing, the map as it is.
static func trail_map(house: Dictionary, king: String, fallen: bool) -> Dictionary:
	if king == "" or not fallen:
		return house
	return with_fallen_kings(house, {king: true})


## A shared King's state off the wire (`KingState`: `{id, hp, max,
## fallen}`, optionally `by`), normalised; `{}` for anything else (null, an
## old server's missing field) — "no shared King".
static func state_of(k: Variant) -> Dictionary:
	if not k is Dictionary:
		return {}
	var d: Dictionary = k
	if not (d.get("hp") is float or d.get("hp") is int) or not (d.get("max") is float or d.get("max") is int):
		return {}
	var hp := int(d["hp"])
	return {
		"id": str(d.get("id", "")), "hp": hp, "max": int(d["max"]),
		"fallen": d.get("fallen") == true or hp <= 0,
		"by": d.get("by") if d.get("by") is String else null,
	}


## Whether two states differ in what anyone sees (`by` aside).
static func changed(a: Dictionary, b: Dictionary) -> bool:
	if a.is_empty() or b.is_empty():
		return a.is_empty() != b.is_empty()
	return a["id"] != b["id"] or a["hp"] != b["hp"] or a["max"] != b["max"] or a["fallen"] != b["fallen"]
