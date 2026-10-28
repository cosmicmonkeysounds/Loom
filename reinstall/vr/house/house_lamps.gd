## The real house's lights in the virtual one (wave 39,
## `docs/loom-w39-contract.md` C5), from the spatial stream's `lights` frame
## ([signal LinkBase.lights_changed], read by [HouseLights]).
##
## - **A bulb per fixture**: an unshaded sphere and a soft additive glow
##   ([method HouseBuilder.glow_quad]) at the fixture's place, in the
##   colour and level the real one shows now; a dark fixture is a grey
##   bulb with no glow. A fixture with a program under it (`pulse`)
##   breathes with [method HouseLights.pulse_factor] — the same curve the
##   web game draws — counted from when it started.
## - **A fixed pool of real lights** ([OmniLight3D], no shadows; 2 / 4 / 5
##   by graphics tier, [method HouseLights.pool_size]) on the lit fixtures
##   nearest the player on their floor ([method HouseLights.pick_pool]),
##   re-picked [constant REPICK] times a second. A light keeps its fixture
##   while it stays picked, so only the farthest ever hops; an unused one is
##   hidden. The pool never grows or shrinks while running.
## - **The ambient**: while frames arrive and the player is in the house,
##   the [Environment]'s ambient and the sun ease toward the night floor
##   ([method HouseLights.ambient]); with no frame (an old server, no lights
##   module yet, the link gone) — and always in the lobby and the intro —
##   they ease back to today's house.
##
## Children are placed in world coordinates ([method HouseBuilder.to_world]),
## re-placed after every rebuild. The game drives [method step] (its own
## `_process` does when it runs in a tree).
class_name HouseLamps
extends Node3D

const BULB_RADIUS := 0.07
## The glow quad's size across (m) at full level.
const HALO_SIZE := 0.8
## A real light's reach (m) and its energy at full level.
const LIGHT_RANGE := 5.0
const LIGHT_ENERGY := 3.0
## Below the bulb: the light sits a little under the fixture, so the
## ceiling it hangs on catches some too.
const LIGHT_DROP := 0.15
## Pool re-picks per second.
const REPICK := 4.0
## The ambient's ease (fraction of the way per second, exponential).
const AMBIENT_EASE := 1.5
## A dark bulb's glass.
const OFF_COLOR := Color("#2a2c33")

var builder: HouseBuilder
## The world's environment and sun; null in a test that has none.
var env: Environment
var sun: DirectionalLight3D
## The graphics tier ([method set_tier]).
var tier := HouseLights.DEFAULT_TIER
## The player is walking the house (PLAYING, not the intro): the ambient
## follows the frame and the pool lights them; else today's look.
var in_house := false
## The player's feet in house coordinates (`[x, y, z]`), or `[]`.
var feet: Callable = func() -> Array: return []

## The frame in force (`{}` = none).
var frame: Dictionary = {}
## Fixture id → `{light, root, bulb, mat, halo, halo_mat, t}`.
var _bulbs := {}
## The pool and the fixture each light is on (`""` = free).
var pool: Array[OmniLight3D] = []
var slots: Array = []
var _repick_in := 0.0
## The ambient now (eased toward [method HouseLights.ambient]).
var ambient_now: Dictionary = HouseLights.ambient({})

static var _bulb_mesh: SphereMesh


func setup(b: HouseBuilder, e: Environment, s: DirectionalLight3D, t: String) -> void:
	builder = b
	env = e
	sun = s
	if builder != null:
		builder.built.connect(_place)
	set_tier(t)
	_apply_ambient()


## Build the fixed pool for a tier (at start; a tier change rebuilds it).
func set_tier(t: String) -> void:
	tier = HouseLights.tier_of(t)
	for l in pool:
		remove_child(l)
		l.queue_free()
	pool = []
	slots = []
	for i in HouseLights.pool_size(tier):
		var l := OmniLight3D.new()
		l.name = "Pool%d" % i
		l.shadow_enabled = false
		l.light_specular = 0.0
		l.omni_range = LIGHT_RANGE
		l.visible = false
		add_child(l)
		pool.append(l)
		slots.append("")
	_repick_in = 0.0


## A new frame (`{}` = none): bulbs made, kept or dropped by id.
func apply(f: Dictionary) -> void:
	frame = f
	var lights: Array = f.get("lights", [])
	var seen := {}
	for l: Dictionary in lights:
		var id := str(l["id"])
		seen[id] = true
		if not _bulbs.has(id):
			_bulbs[id] = _make_bulb(id)
		var b: Dictionary = _bulbs[id]
		if l.get("pulse", false) != true:
			b["t"] = 0.0
		b["light"] = l
	for id: String in _bulbs.keys():
		if not seen.has(id):
			(_bulbs[id]["root"] as Node3D).queue_free()
			_bulbs.erase(id)
	for i in slots.size():
		if slots[i] != "" and not _bulbs.has(slots[i]):
			slots[i] = ""
	_place()
	_repick_in = 0.0
	step(0.0)


## The bulbs' ids (in no order).
func bulb_ids() -> Array:
	return _bulbs.keys()


## A bulb's node (`null` when there is none).
func bulb(id: String) -> Node3D:
	return _bulbs[id]["root"] if _bulbs.has(id) else null


## What a bulb shows now (its level × the pulse), 0 when there is none.
func bulb_level(id: String) -> float:
	if not _bulbs.has(id):
		return 0.0
	return HouseLights.shown_level(_bulbs[id]["light"], float(_bulbs[id]["t"]))


func _make_bulb(id: String) -> Dictionary:
	if _bulb_mesh == null:
		_bulb_mesh = SphereMesh.new()
		_bulb_mesh.radius = BULB_RADIUS
		_bulb_mesh.height = BULB_RADIUS * 2.0
		_bulb_mesh.radial_segments = 10
		_bulb_mesh.rings = 6
	var root := Node3D.new()
	root.name = "Lamp_%s" % id
	var mi := MeshInstance3D.new()
	mi.name = "Bulb"
	mi.mesh = _bulb_mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = OFF_COLOR
	mi.material_override = mat
	root.add_child(mi)
	var halo := HouseBuilder.glow_quad(Color.WHITE, HALO_SIZE)
	halo.name = "Glow"
	root.add_child(halo)
	add_child(root)
	return {"root": root, "bulb": mi, "mat": mat, "halo": halo, "halo_mat": halo.material_override, "t": 0.0, "light": {}}


## Every bulb (and every pool light on one) at its fixture, after a
## rebuild moved the house.
func _place() -> void:
	if builder == null:
		return
	for id: String in _bulbs:
		var l: Dictionary = _bulbs[id]["light"]
		if not l.is_empty():
			(_bulbs[id]["root"] as Node3D).position = builder.to_world(HouseLights.pos_of(l))
	for i in pool.size():
		if slots[i] != "":
			pool[i].position = _light_spot(slots[i])


func _light_spot(id: String) -> Vector3:
	var p := HouseLights.pos_of(_bulbs[id]["light"])
	p[1] = float(p[1]) - LIGHT_DROP
	return builder.to_world(p) if builder != null else HouseFrames.vec(p)


func _process(delta: float) -> void:
	step(delta)


## One frame: the pulses, the pool, the ambient.
func step(delta: float) -> void:
	for id: String in _bulbs:
		var b: Dictionary = _bulbs[id]
		if (b["light"] as Dictionary).get("pulse", false) == true:
			b["t"] = float(b["t"]) + delta
		_draw_bulb(b)
	_repick_in -= delta
	if _repick_in <= 0.0:
		_repick_in = 1.0 / REPICK
		_repick()
	for i in pool.size():
		var l := pool[i]
		if slots[i] == "":
			l.visible = false
			continue
		var b: Dictionary = _bulbs[slots[i]]
		l.visible = true
		l.light_color = Color(str(b["light"]["color"]))
		l.light_energy = LIGHT_ENERGY * HouseLights.shown_level(b["light"], float(b["t"]))
	var want := HouseLights.ambient(frame if in_house else {})
	var k := 1.0 - exp(-AMBIENT_EASE * delta) if delta > 0.0 else 0.0
	ambient_now = {
		"energy": lerpf(float(ambient_now["energy"]), float(want["energy"]), k),
		"sun": lerpf(float(ambient_now["sun"]), float(want["sun"]), k),
		"color": (ambient_now["color"] as Color).lerp(want["color"], k),
	}
	_apply_ambient()


func _draw_bulb(b: Dictionary) -> void:
	var l: Dictionary = b["light"]
	var shown := HouseLights.shown_level(l, float(b["t"]))
	var c := Color(str(l.get("color", HouseLights.SETTLED_COLOR)))
	# Brighter than white at full level: it rolls off in the tone map (and
	# blooms on `high`).
	var k := 0.6 + 1.2 * shown
	(b["mat"] as StandardMaterial3D).albedo_color = OFF_COLOR.lerp(Color(c.r * k, c.g * k, c.b * k), clampf(shown * 3.0, 0.0, 1.0))
	var halo: MeshInstance3D = b["halo"]
	halo.visible = shown > 0.01
	if halo.visible:
		(b["halo_mat"] as StandardMaterial3D).albedo_color = Color(c.r, c.g, c.b, clampf(0.25 + 0.6 * shown, 0.0, 0.85))
		halo.scale = Vector3.ONE * (0.6 + 0.6 * shown)


## Re-pick the pool: the lit fixtures nearest the player on their floor
## (by level, not the pulse, so a breathing fixture never hops in and
## out); a light keeps its fixture while it stays picked.
func _repick() -> void:
	var want: Array = []
	var at: Array = feet.call() if in_house else []
	if not frame.is_empty() and builder != null and not builder.house.is_empty() and at.size() == 3:
		var fl := str(HouseLocate.locate(builder.house, at)["floor"])
		want = HouseLights.pick_pool(frame.get("lights", []), builder.house, fl, at, pool.size())
	for i in slots.size():
		if slots[i] != "" and not want.has(slots[i]):
			slots[i] = ""
	for id: String in want:
		if slots.has(id):
			continue
		var free := slots.find("")
		if free < 0:
			break
		slots[free] = id
		pool[free].position = _light_spot(id)


func _apply_ambient() -> void:
	if env != null:
		env.ambient_light_energy = float(ambient_now["energy"])
		env.ambient_light_color = ambient_now["color"]
	if sun != null:
		sun.light_energy = float(ambient_now["sun"])
