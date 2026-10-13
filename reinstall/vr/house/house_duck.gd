## Where Gerald hides — a port of `house/src/duck.ts` (§2.1). The server
## picks the duck; the game only needs this for its offline dev mode, where
## there is no server to ask.
class_name HouseDuck
extends RefCounted

## The highest a duck spot may sit above its room's floor, in metres — and
## the server's `found` height check (`core/server/spatial.ts` `nearDuck`),
## which the game's own reach test mirrors ([method Game.is_at_duck]).
const DUCK_MAX_RISE := 1.2
const FNV_OFFSET := 0x811c9dc5
const FNV_PRIME := 0x01000193


## FNV-1a 32 over the string's UTF-8 bytes, unsigned.
static func fnv1a32(s: String) -> int:
	var h := FNV_OFFSET
	for byte in s.to_utf8_buffer():
		h = h ^ byte
		h = (h * FNV_PRIME) & 0xffffffff
	return h


## The duck spot for a seed: the spots outside the spawn room (unless that
## leaves none), minus `avoid` (unless that leaves none), indexed by
## `fnv1a32(seed) % count`. `null` on a house with no spots.
static func pick_duck_spot(house: Dictionary, seed: String, avoid: Array = []) -> Variant:
	var spots: Array = house.get("duck", {}).get("spots", [])
	var spawn_room := str(house.get("spawn", {}).get("room", ""))
	var candidates: Array = spots.filter(func(s: Dictionary) -> bool: return str(s["room"]) != spawn_room)
	if candidates.is_empty():
		candidates = spots
	var kept: Array = candidates.filter(func(s: Dictionary) -> bool: return not avoid.has(str(s["id"])))
	if not kept.is_empty():
		candidates = kept
	if candidates.is_empty():
		return null
	return candidates[fnv1a32(seed) % candidates.size()]
