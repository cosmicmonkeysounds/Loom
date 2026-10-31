## Prop models (waves 47, 49) — the literal port of `@loom/house` `models.ts`,
## diffed against `res://test/golden/models.json`. A `box` or `cylinder`
## prop with a known `model` is drawn from these parts (boxes and
## cylinders in the prop's own frame: x across `w`, y up from the base, z
## along `d`, the front at −z); it still collides as its plain shape. Each
## part has a role [HouseBuilder] colours: `body` the prop's `color` (else
## the model's), `neon` its `neon` (else the model's), the rest
## [constant ROLE_COLORS]. Also the games' neon and haze numbers.
class_name HouseModels
extends RefCounted

const ROLE_COLORS := {
	"trim": "#c3ccd6",
	"dark": "#101318",
	"screen": "#7fd4ff",
	"glass": "#9fd6f2",
	"leaf": "#26c46a",
	"alert": "#ff2a4a",
	"wood": "#7a5230",
	"flame": "#ff7a1a",
}
const PART_ROLES := ["body", "trim", "dark", "neon", "screen", "glass", "leaf", "alert", "wood", "flame"]
## The roles drawn glowing (unlit), beside `neon`.
const GLOW_ROLES := ["screen", "alert", "flame"]

const WHITE := "#f2f5f8"
const CYAN := "#29f4ff"
const MAGENTA := "#ff2bd6"
const VIOLET := "#8a5cff"
const BLUE := "#2b6cff"
const LIME := "#7dff3a"
const RED := "#ff2a4a"
const AMBER := "#ffb02e"
const PINK := "#ff5fa2"
const SOOT := "#1c1f26"
const WALNUT := "#6b4528"
const CREAM := "#f4ead8"

## The catalogue, in the map editor's order.
const PROP_MODELS := [
	{"id": "wall", "label": "Wall panel", "group": "structure", "kind": "box", "size": [2, 2.4, 0.12], "color": WHITE, "neon": CYAN},
	{"id": "pillar", "label": "Pillar", "group": "structure", "kind": "box", "size": [0.4, 2.4, 0.4], "color": WHITE, "neon": MAGENTA},
	{"id": "cabinet", "label": "Cabinet", "group": "structure", "kind": "box", "size": [0.9, 2, 0.5], "color": WHITE, "neon": CYAN},
	{"id": "filing", "label": "Filing cabinet", "group": "office", "kind": "box", "size": [0.5, 1.3, 0.6], "color": "#e4e9ee", "neon": CYAN},
	{"id": "shelf", "label": "Shelf", "group": "structure", "kind": "box", "size": [1.2, 1.8, 0.4], "color": WHITE, "neon": VIOLET},
	{"id": "desk", "label": "Desk", "group": "office", "kind": "box", "size": [1.4, 0.75, 0.7], "color": WHITE, "neon": CYAN},
	{"id": "table", "label": "Table", "group": "office", "kind": "box", "size": [1.6, 0.75, 1], "color": WHITE, "neon": MAGENTA},
	{"id": "counter", "label": "Counter", "group": "structure", "kind": "box", "size": [1.8, 0.95, 0.6], "color": WHITE, "neon": CYAN},
	{"id": "rack", "label": "Server rack", "group": "computer", "kind": "box", "size": [0.6, 2, 1], "color": WHITE, "neon": CYAN},
	{"id": "mainframe", "label": "Mainframe", "group": "computer", "kind": "box", "size": [1.2, 2, 0.8], "color": "#e9edf2", "neon": MAGENTA},
	{"id": "tower", "label": "PC tower", "group": "computer", "kind": "box", "size": [0.2, 0.45, 0.45], "color": "#eceae4", "neon": LIME},
	{"id": "crt", "label": "CRT monitor", "group": "computer", "kind": "box", "size": [0.42, 0.4, 0.42], "color": "#eceae4", "neon": LIME},
	{"id": "workstation", "label": "Workstation", "group": "computer", "kind": "box", "size": [1.4, 1.2, 0.75], "color": WHITE, "neon": CYAN},
	{"id": "screenwall", "label": "Video wall", "group": "computer", "kind": "box", "size": [2, 1.4, 0.1], "color": WHITE, "neon": CYAN},
	{"id": "printer", "label": "Printer", "group": "computer", "kind": "box", "size": [0.5, 0.35, 0.45], "color": "#eceae4", "neon": LIME},
	{"id": "cables", "label": "Cable run", "group": "computer", "kind": "box", "size": [1.5, 0.06, 0.3], "color": WHITE, "neon": MAGENTA},
	{"id": "popup", "label": "Error dialog", "group": "computer", "kind": "box", "size": [1, 0.7, 0.04], "color": "#d4d8de", "neon": BLUE},
	{"id": "camera", "label": "Security camera", "group": "computer", "kind": "cylinder", "size": [0.4, 2.2, 0.4], "color": WHITE, "neon": RED},
	{"id": "chair", "label": "Office chair", "group": "office", "kind": "box", "size": [0.6, 1, 0.6], "color": WHITE, "neon": CYAN},
	{"id": "cooler", "label": "Water cooler", "group": "office", "kind": "cylinder", "size": [0.35, 1.3, 0.35], "color": WHITE, "neon": CYAN},
	{"id": "plant", "label": "Plastic plant", "group": "office", "kind": "cylinder", "size": [0.5, 1.1, 0.5], "color": WHITE, "neon": LIME},
	{"id": "bin", "label": "Recycle bin", "group": "office", "kind": "cylinder", "size": [0.35, 0.5, 0.35], "color": WHITE, "neon": LIME},
	{"id": "tube", "label": "Neon tube", "group": "structure", "kind": "cylinder", "size": [0.12, 1.8, 0.12], "color": WHITE, "neon": MAGENTA},
	# Wave 49: the house's own things. Same look: gloss, chrome, a neon line.
	{"id": "stove", "label": "Stove", "group": "home", "kind": "box", "size": [0.75, 0.9, 0.6], "color": WHITE, "neon": AMBER},
	{"id": "microwave", "label": "Broken microwave", "group": "home", "kind": "box", "size": [0.5, 0.3, 0.4], "color": "#e4e9ee", "neon": RED},
	{"id": "toaster", "label": "Toaster", "group": "home", "kind": "box", "size": [0.3, 0.2, 0.18], "color": "#d6dde4", "neon": AMBER},
	{"id": "fridge", "label": "Fridge", "group": "home", "kind": "box", "size": [0.8, 1.8, 0.8], "color": WHITE, "neon": CYAN},
	{"id": "sink", "label": "Sink", "group": "home", "kind": "box", "size": [0.45, 0.85, 0.6], "color": WHITE, "neon": CYAN},
	{"id": "toilet", "label": "Toilet", "group": "home", "kind": "box", "size": [0.4, 0.75, 0.65], "color": WHITE, "neon": CYAN},
	{"id": "bathtub", "label": "Bathtub", "group": "home", "kind": "box", "size": [0.75, 0.55, 1.5], "color": WHITE, "neon": CYAN},
	{"id": "washer", "label": "Washer", "group": "home", "kind": "box", "size": [0.7, 0.85, 0.7], "color": WHITE, "neon": CYAN},
	{"id": "dryer", "label": "Dryer", "group": "home", "kind": "box", "size": [0.7, 0.85, 0.7], "color": WHITE, "neon": AMBER},
	{"id": "couch", "label": "Couch", "group": "home", "kind": "box", "size": [2, 0.85, 0.9], "color": "#3a3f55", "neon": MAGENTA},
	{"id": "armchair", "label": "Armchair", "group": "home", "kind": "box", "size": [0.9, 0.9, 0.85], "color": "#3a3f55", "neon": MAGENTA},
	{"id": "bed", "label": "Bed", "group": "home", "kind": "box", "size": [2, 0.55, 1.6], "color": "#d8dde8", "neon": VIOLET},
	{"id": "tv", "label": "Old TV", "group": "home", "kind": "box", "size": [1.1, 1.2, 0.5], "color": WALNUT, "neon": BLUE},
	{"id": "lamp", "label": "Floor lamp", "group": "home", "kind": "cylinder", "size": [0.4, 1.7, 0.4], "color": WHITE, "neon": AMBER},
	{"id": "fireplace", "label": "Fireplace", "group": "home", "kind": "box", "size": [1.6, 1.1, 0.5], "color": WHITE, "neon": AMBER},
	{"id": "bbq", "label": "BBQ", "group": "home", "kind": "cylinder", "size": [0.6, 1, 0.6], "color": SOOT, "neon": AMBER},
	{"id": "gnome", "label": "Garden gnome", "group": "home", "kind": "cylinder", "size": [0.3, 0.6, 0.3], "color": "#2b6cff", "neon": RED},
	{"id": "modular", "label": "Modular synth", "group": "studio", "kind": "box", "size": [1.2, 1.6, 0.35], "color": SOOT, "neon": LIME},
	{"id": "mixing", "label": "Mixing desk", "group": "studio", "kind": "box", "size": [1.6, 0.8, 0.7], "color": SOOT, "neon": CYAN},
	{"id": "speaker", "label": "Speaker cabinet", "group": "studio", "kind": "box", "size": [0.4, 1.1, 0.4], "color": SOOT, "neon": MAGENTA},
	{"id": "amp", "label": "Guitar amp", "group": "studio", "kind": "box", "size": [0.6, 0.5, 0.3], "color": SOOT, "neon": RED},
	{"id": "turntable", "label": "Turntable", "group": "studio", "kind": "box", "size": [0.5, 0.14, 0.4], "color": "#e4e9ee", "neon": CYAN},
	{"id": "piano", "label": "Upright piano", "group": "studio", "kind": "box", "size": [1.5, 1.25, 0.6], "color": WALNUT, "neon": VIOLET},
	{"id": "arcade", "label": "Arcade cabinet", "group": "studio", "kind": "box", "size": [0.7, 1.75, 0.75], "color": SOOT, "neon": MAGENTA},
	# Wave 49: what a program starts to see. Mostly placed with `from`.
	{"id": "teatable", "label": "Tea party", "group": "strange", "kind": "box", "size": [2.4, 0.95, 1], "color": WHITE, "neon": PINK},
	{"id": "teapot", "label": "Teapot", "group": "strange", "kind": "box", "size": [0.3, 0.25, 0.22], "color": CREAM, "neon": PINK},
	{"id": "clock", "label": "Grandfather clock", "group": "strange", "kind": "box", "size": [0.6, 2.2, 0.4], "color": WALNUT, "neon": AMBER},
	{"id": "mushroom", "label": "Mushroom", "group": "strange", "kind": "cylinder", "size": [0.7, 0.9, 0.7], "color": CREAM, "neon": LIME},
	{"id": "bottle", "label": "Little bottle", "group": "strange", "kind": "cylinder", "size": [0.12, 0.3, 0.12], "color": CREAM, "neon": BLUE},
	{"id": "door", "label": "Door to nowhere", "group": "strange", "kind": "box", "size": [1, 2.1, 0.12], "color": WHITE, "neon": RED},
	{"id": "spiral", "label": "Spiral stairs", "group": "strange", "kind": "cylinder", "size": [1.6, 2.7, 1.6], "color": WHITE, "neon": VIOLET},
	{"id": "mirror", "label": "Tall mirror", "group": "strange", "kind": "box", "size": [0.8, 2, 0.1], "color": WALNUT, "neon": CYAN},
	{"id": "hole", "label": "Rabbit hole", "group": "strange", "kind": "cylinder", "size": [1.4, 0.02, 1.4], "color": SOOT, "neon": VIOLET},
	{"id": "card", "label": "Card soldier", "group": "strange", "kind": "box", "size": [0.7, 1.9, 0.08], "color": WHITE, "neon": RED},
	{"id": "flamingo", "label": "Flamingo", "group": "strange", "kind": "box", "size": [0.4, 1.1, 0.6], "color": PINK, "neon": PINK},
]
## The kinds a model is drawn on.
const MODEL_KINDS := ["box", "cylinder"]

## A neon strip's thickness.
const N := 0.014

# --- the games' neon and haze ----------------------------------------------

## Neon strips along every `wall` segment (both faces): skirting [0] m over
## the floor, cove [1] m under the top, each this tall and this far proud.
const NEON_STRIP_AT := [0.06, 0.05]
const NEON_STRIP_H := 0.012
const NEON_STRIP_PROUD := 0.006
const NEON_SKIRT := CYAN
const NEON_COVE := MAGENTA
## Neon is drawn this many times its colour (unlit), so it glows.
const NEON_GAIN := 1.3
## The haze sheets per floor: [0] m over its floor, [1] m under its
## ceiling; opacities, tile, drift (m/s, x and z); none on `low`, the floor
## one on `medium`, both on `high`.
const HAZE_AT := [0.3, 0.35]
const HAZE_OPACITY := [0.2, 0.12]
const HAZE_TILE_M := 4.0
const HAZE_DRIFT := [[0.03, 0.012], [-0.018, 0.022]]
const HAZE_COLOR := "#9a8cff"
## The fog's colour (the background too) and three's FogExp2 density.
const HAZE_FOG := "#15123a"
const HAZE_FOG_DENSITY := 0.07
const NEON_FLICKER_S := 9.7


## The neon's brightness at `t` s (0 … 1): steady, but every
## [constant NEON_FLICKER_S] it stutters for a third of a second.
static func neon_flicker(t: float) -> float:
	var p := fposmod(t, NEON_FLICKER_S)
	if p >= 0.35:
		return 1.0
	return 1.0 if sin(p * 90.0) > 0.0 else 0.35


## How many haze sheets a floor gets on a graphics tier.
static func haze_layers(tier: String) -> int:
	match HouseLights.tier_of(tier):
		"low":
			return 0
		"high":
			return 2
	return 1


static func prop_model(id: Variant) -> Dictionary:
	for m: Dictionary in PROP_MODELS:
		if m["id"] == id:
			return m
	return {}


## The body colour a model prop is drawn in.
static func model_body_color(prop: Dictionary) -> String:
	if prop.get("color") is String:
		return str(prop["color"])
	var m := prop_model(prop.get("model"))
	return str(m.get("color", WHITE))


## The neon colour a model prop is drawn in.
static func model_neon_color(prop: Dictionary) -> String:
	if prop.get("neon") is String:
		return str(prop["neon"])
	var m := prop_model(prop.get("model"))
	return str(m.get("neon", CYAN))


## The parts of `prop`'s model, or null when it draws as its plain shape.
static func model_parts(prop: Dictionary) -> Variant:
	var model: Variant = prop.get("model")
	if not (model is String) or not MODEL_KINDS.has(str(prop.get("kind", ""))) or prop_model(model).is_empty():
		return null
	var size: Array = prop["size"]
	return parts_of(str(model), float(size[0]), float(size[1]), float(size[2]))


static func _box(out: Array, role: String, cx: float, cy: float, cz: float, sx: float, sy: float, sz: float) -> void:
	out.append({"role": role, "shape": "box", "axis": "y", "c": Vector3(cx, cy, cz), "s": Vector3(maxf(0.0, sx), maxf(0.0, sy), maxf(0.0, sz))})


static func _cyl(out: Array, role: String, axis: String, cx: float, cy: float, cz: float, sx: float, sy: float, sz: float) -> void:
	out.append({"role": role, "shape": "cyl", "axis": axis, "c": Vector3(cx, cy, cz), "s": Vector3(maxf(0.0, sx), maxf(0.0, sy), maxf(0.0, sz))})


static func _add(out: Array, parts: Array, dx: float, dy: float, dz: float) -> void:
	for p: Dictionary in parts:
		var q := p.duplicate()
		q["c"] = p["c"] + Vector3(dx, dy, dz)
		out.append(q)


## A model's parts at size `w × h × d` (an unknown id: none).
static func parts_of(id: String, w: float, h: float, d: float) -> Array:
	var out: Array = []
	var front := -d / 2.0
	match id:
		"wall":
			var base := minf(0.06, h * 0.1)
			var cap := minf(0.025, h * 0.05)
			var mid := base + (h - base - cap) / 2.0
			_box(out, "body", 0, mid, 0, w, h - base - cap, d)
			_box(out, "dark", 0, base / 2.0, 0, w, base, d + 0.01)
			_box(out, "trim", 0, h - cap / 2.0, 0, w, cap, d + 0.01)
			for side: float in [-1.0, 1.0]:
				_box(out, "neon", 0, base + 0.02, side * (d / 2.0 + 0.004), w, N, 0.008)
				_box(out, "neon", 0, h - cap - 0.03, side * (d / 2.0 + 0.004), w, N, 0.008)
			var n := maxi(1, floori(w / 1.0 + 0.5))
			for i in range(1, n):
				_box(out, "dark", -w / 2.0 + (w * i) / n, mid, 0, 0.008, h - base - cap - 0.04, d + 0.006)
		"pillar":
			var base := minf(0.08, h * 0.1)
			var cap := minf(0.04, h * 0.05)
			var mid := base + (h - base - cap) / 2.0
			var length := (h - base - cap) * 0.8
			_box(out, "body", 0, mid, 0, w - 0.02, h - base - cap, d - 0.02)
			_box(out, "dark", 0, base / 2.0, 0, w, base, d)
			_box(out, "trim", 0, h - cap / 2.0, 0, w, cap, d)
			for side: float in [-1.0, 1.0]:
				_box(out, "neon", 0, mid, side * (d / 2.0 - 0.006), minf(0.03, w * 0.15), length, 0.008)
				_box(out, "neon", side * (w / 2.0 - 0.006), mid, 0, 0.008, length, minf(0.03, d * 0.15))
		"cabinet":
			var plinth := minf(0.08, h * 0.08)
			var cap := minf(0.03, h * 0.04)
			var mid := plinth + (h - plinth - cap) / 2.0
			_box(out, "body", 0, mid, 0.004, w, h - plinth - cap, d - 0.008)
			_box(out, "dark", 0, plinth / 2.0, 0.02, w - 0.04, plinth, d - 0.04)
			_box(out, "trim", 0, h - cap / 2.0, 0, w, cap, d)
			var handle := minf(0.3, h * 0.15)
			if w >= 0.6:
				_box(out, "dark", 0, mid, front + 0.005, 0.008, h - plinth - cap - 0.04, 0.006)
				for side: float in [-1.0, 1.0]:
					_box(out, "trim", side * 0.04, plinth + (h - plinth - cap) * 0.55, front + 0.01, 0.02, handle, 0.02)
			else:
				_box(out, "trim", w / 2.0 - 0.06, plinth + (h - plinth - cap) * 0.55, front + 0.01, 0.02, handle, 0.02)
			_box(out, "neon", 0, h - cap - 0.012, front + 0.004, w - 0.04, N, 0.008)
		"filing":
			var plinth := minf(0.05, h * 0.06)
			var n := maxi(2, floori((h - plinth) / 0.32 + 0.5))
			var dh := (h - plinth) / n
			_box(out, "body", 0, plinth + (h - plinth) / 2.0, 0, w, h - plinth, d)
			_box(out, "dark", 0, plinth / 2.0, 0.03, w - 0.03, plinth, d - 0.06)
			for i in n:
				var y0 := plinth + dh * i
				if i > 0:
					_box(out, "dark", 0, y0, front - 0.002, w - 0.02, 0.008, 0.006)
				_box(out, "trim", 0, y0 + dh * 0.55, front - 0.0125, w * 0.4, 0.025, 0.025)
				_box(out, "neon", 0, y0 + dh * 0.8, front - 0.002, w * 0.22, 0.03, 0.004)
		"shelf":
			var side := 0.03
			var board := 0.025
			var n := maxi(2, floori(h / 0.4 + 0.5))
			var iw := w - 2.0 * side
			for s: float in [-1.0, 1.0]:
				_box(out, "body", s * (w / 2.0 - side / 2.0), h / 2.0, 0, side, h, d)
			_box(out, "dark", 0, h / 2.0, d / 2.0 - 0.005, iw, h, 0.01)
			for i in n + 1:
				var y := board / 2.0 + ((h - board) * i) / n
				_box(out, "body", 0, y, 0, iw, board, d - 0.01)
				if i >= 1:
					_box(out, "neon", 0, y - board / 2.0 - 0.006, front + 0.012, iw - 0.02, 0.01, 0.01)
			var space := (h - board) / n - board
			var k := floori((iw - 0.04) / 0.09)
			if space >= 0.12:
				var roles := ["trim", "dark", "body"]
				for i in n:
					var bottom := board + ((h - board) * i) / n
					for j in k:
						if (j * 7 + i * 3) % 5 == 4:
							continue
						var bh := space * (0.55 + 0.08 * ((j * 3 + i) % 4))
						_box(out, roles[(i + j) % 3], -(iw - 0.04) / 2.0 + 0.045 + j * 0.09, bottom + bh / 2.0, d * 0.1, 0.07, bh, d * 0.7)
		"desk":
			var top := 0.04
			var leg := 0.04
			_box(out, "body", 0, h - top / 2.0, 0, w, top, d)
			for sx: float in [-1.0, 1.0]:
				for sz: float in [-1.0, 1.0]:
					_box(out, "trim", sx * (w / 2.0 - leg / 2.0 - 0.02), (h - top) / 2.0, sz * (d / 2.0 - leg / 2.0 - 0.02), leg, h - top, leg)
			_box(out, "dark", 0, (h - top) * 0.6, d / 2.0 - 0.04, w - 0.12, (h - top) * 0.45, 0.02)
			_box(out, "neon", 0, h - top - 0.008, front + 0.01, w - 0.08, 0.01, 0.01)
		"table":
			var top := 0.035
			_box(out, "body", 0, h - top / 2.0, 0, w, top, d)
			for sx: float in [-1.0, 1.0]:
				for sz: float in [-1.0, 1.0]:
					_cyl(out, "trim", "y", sx * (w / 2.0 - 0.06), (h - top) / 2.0, sz * (d / 2.0 - 0.06), 0.05, h - top, 0.05)
			for s: float in [-1.0, 1.0]:
				_box(out, "neon", 0, h - top - 0.008, s * (d / 2.0 - 0.03), w - 0.06, 0.01, 0.01)
				_box(out, "neon", s * (w / 2.0 - 0.03), h - top - 0.008, 0, 0.01, 0.01, d - 0.06)
		"counter":
			var top := 0.04
			var kick := minf(0.1, h * 0.12)
			var mid := kick + (h - top - kick) / 2.0
			_box(out, "body", 0, mid, 0.02, w - 0.02, h - top - kick, d - 0.04)
			_box(out, "dark", 0, kick / 2.0, 0.04, w - 0.06, kick, d - 0.08)
			_box(out, "trim", 0, h - top / 2.0, 0, w, top, d)
			_box(out, "neon", 0, h - top - 0.01, front + 0.03, w - 0.04, N, 0.01)
			var n := maxi(1, floori(w / 0.6 + 0.5))
			for i in range(1, n):
				_box(out, "dark", -w / 2.0 + (w * i) / n, mid, front + 0.04 - 0.002, 0.008, h - top - kick - 0.04, 0.006)
		"rack":
			var m := minf(0.1, h * 0.06)
			var n := maxi(3, floori((h - 2.0 * m) / 0.09))
			var uh := (h - 2.0 * m) / n
			_box(out, "body", 0, h / 2.0, 0, w, h, d)
			_box(out, "dark", 0, h / 2.0, front - 0.002, w - 0.06, h - 2.0 * m + 0.02, 0.004)
			for i in n:
				var y := m + uh * (i + 0.5)
				_box(out, "trim", 0, y, front - 0.006, w - 0.1, uh * 0.78, 0.004)
				_box(out, "alert" if i % 7 == 3 else "neon", -w / 2.0 + 0.08 + ((i * 5) % 3) * 0.03, y, front - 0.01, 0.02, minf(0.012, uh * 0.3), 0.004)
			for s: float in [-1.0, 1.0]:
				_box(out, "neon", s * (w / 2.0 - 0.015), h / 2.0, front - 0.006, 0.012, h - 0.1, 0.012)
		"mainframe":
			_box(out, "body", 0, h / 2.0 - 0.02, 0, w - 0.01, h - 0.04, d - 0.01)
			_box(out, "trim", 0, h - 0.02, 0, w, 0.04, d)
			_box(out, "dark", 0, h * 0.68, front + 0.002, w * 0.86, h * 0.42, 0.006)
			var r := minf(w * 0.19, h * 0.11)
			for s: float in [-1.0, 1.0]:
				_cyl(out, "trim", "z", s * w * 0.22, h * 0.7, front - 0.008, 2.0 * r, 2.0 * r, 0.02)
				_cyl(out, "dark", "z", s * w * 0.22, h * 0.7, front - 0.02, r * 0.5, r * 0.5, 0.012)
			for row in 3:
				for col in 6:
					var i := row * 6 + col
					var role := "alert" if i % 5 == 2 else ("screen" if i % 3 == 0 else "neon")
					_box(out, role, -w * 0.35 + col * ((w * 0.7) / 5.0), h * 0.36 - row * 0.06, front - 0.003, 0.03, 0.03, 0.006)
			_box(out, "dark", 0, h * 0.15, front - 0.001, w * 0.86, h * 0.2, 0.004)
			_box(out, "neon", 0, h - 0.06, front - 0.004, w - 0.04, N, 0.008)
		"tower":
			_box(out, "body", 0, h / 2.0, 0, w, h, d)
			_box(out, "dark", 0, h / 2.0, front - 0.004, w - 0.01, h - 0.01, 0.008)
			for f: float in [0.82, 0.72]:
				_box(out, "trim", 0, h * f, front - 0.01, w * 0.75, h * 0.06, 0.004)
			_cyl(out, "neon", "z", 0, h * 0.55, front - 0.01, w * 0.18, w * 0.18, 0.004)
			_box(out, "neon", w / 2.0 + 0.002, h * 0.5, 0, 0.004, h * 0.5, 0.012)
		"crt":
			var stand := minf(0.07, h * 0.18)
			var sh := h - stand
			_box(out, "body", 0, stand * 0.2, 0, w * 0.55, stand * 0.4, d * 0.55)
			_box(out, "trim", 0, stand * 0.7, 0, 0.08, stand * 0.6, 0.08)
			_box(out, "body", 0, stand + sh / 2.0, front + d * 0.225, w, sh, d * 0.45)
			_box(out, "body", 0, stand + sh * 0.45, front + d * 0.725, w * 0.75, sh * 0.8, d * 0.55)
			_box(out, "screen", 0, stand + sh * 0.52, front - 0.002, w * 0.8, sh * 0.72, 0.004)
			_box(out, "neon", w * 0.38, stand + sh * 0.08, front - 0.002, 0.02, 0.012, 0.004)
		"workstation":
			var dh := minf(0.74, h * 0.62)
			_box(out, "body", 0, dh - 0.02, 0, w, 0.04, d)
			for s: float in [-1.0, 1.0]:
				_box(out, "trim", s * (w / 2.0 - 0.02), (dh - 0.04) / 2.0, 0, 0.04, dh - 0.04, d - 0.04)
			_box(out, "neon", 0, dh - 0.048, front + 0.01, w - 0.1, 0.01, 0.01)
			var mw := minf(0.42, w * 0.4)
			var md := minf(0.42, d * 0.6)
			_add(out, parts_of("crt", mw, h - dh, md), 0, dh, d / 2.0 - md / 2.0 - 0.03)
			var kw := minf(0.45, w * 0.35)
			var kz := front + minf(0.16, d * 0.2)
			_box(out, "dark", 0, dh + 0.012, kz, kw, 0.024, minf(0.15, d * 0.2))
			_box(out, "trim", 0, dh + 0.026, kz, kw - 0.03, 0.006, minf(0.12, d * 0.16))
			_box(out, "trim", minf(kw / 2.0 + 0.12, w / 2.0 - 0.05), dh + 0.015, kz, 0.06, 0.03, 0.1)
			var th := minf(0.45, dh - 0.06)
			var td := minf(0.45, d - 0.1)
			if w >= 0.7:
				_add(out, parts_of("tower", 0.2, th, td), w / 2.0 - 0.18, 0, 0)
		"screenwall":
			_box(out, "dark", 0, h / 2.0, 0, w, h, d)
			var cols := maxi(1, floori(w / 0.65 + 0.5))
			var rows := maxi(1, floori(h / 0.5 + 0.5))
			var cw := (w - 0.04) / cols
			var ch := (h - 0.04) / rows
			for r in rows:
				for c in cols:
					_box(out, "alert" if (r * cols + c) % 5 == 3 else "screen", -w / 2.0 + 0.02 + cw * (c + 0.5), 0.02 + ch * (r + 0.5), front - 0.002, cw - 0.03, ch - 0.03, 0.004)
			for y: float in [0.012, h - 0.012]:
				_box(out, "neon", 0, y, front - 0.004, w, N, 0.008)
		"printer":
			var fz := front + d * 0.15
			_box(out, "body", 0, h * 0.4, d * 0.075, w, h * 0.8, d * 0.85)
			_box(out, "trim", 0, h * 0.85, d * 0.1, w * 0.92, h * 0.1, d * 0.7)
			_box(out, "trim", 0, h * 0.85, d * 0.4, w * 0.6, h * 0.3, 0.01)
			_box(out, "dark", 0, h * 0.3, fz - 0.003, w * 0.7, 0.03, 0.006)
			_box(out, "trim", 0, h * 0.22, front + d * 0.075, w * 0.62, 0.012, d * 0.15)
			_box(out, "neon", w * 0.38, h * 0.7, fz - 0.002, 0.025, 0.012, 0.004)
			_box(out, "screen", w * 0.22, h * 0.7, fz - 0.002, 0.08, 0.03, 0.004)
		"cables":
			var n := maxi(2, floori(d / 0.06))
			var dia := minf(h, (d / n) * 0.8)
			for i in n:
				_cyl(out, "neon" if i == floori(n / 2.0) else "dark", "x", 0, dia / 2.0, -d / 2.0 + (d * (i + 0.5)) / n, w, dia, dia)
			for s: float in [-1.0, 1.0]:
				_box(out, "trim", s * (w / 2.0 - 0.05), h / 2.0, 0, 0.04, h, d)
		"popup":
			_box(out, "body", 0, h / 2.0, 0, w, h, d)
			var bar := h * 0.14
			_box(out, "neon", 0, h - bar / 2.0 - 0.01, front - 0.002, w - 0.02, bar, 0.004)
			_box(out, "trim", w / 2.0 - 0.01 - bar * 0.6, h - bar / 2.0 - 0.01, front - 0.005, bar * 0.7, bar * 0.7, 0.004)
			_cyl(out, "alert", "z", -w * 0.3, h * 0.52, front - 0.002, h * 0.22, h * 0.22, 0.004)
			for i in 3:
				_box(out, "dark", w * 0.08, h * 0.62 - i * h * 0.1, front - 0.002, w * (0.45 - i * 0.08), 0.012, 0.004)
			_box(out, "trim", 0, h * 0.14, front - 0.004, w * 0.22, h * 0.12, 0.008)
		"camera":
			var head := minf(0.15, h * 0.2)
			_cyl(out, "dark", "y", 0, 0.02, 0, w, 0.04, d)
			_cyl(out, "neon", "y", 0, 0.06, 0, minf(0.08, w * 0.5), 0.02, minf(0.08, d * 0.5))
			_cyl(out, "trim", "y", 0, (h - head) / 2.0, 0, 0.05, h - head, 0.05)
			_box(out, "trim", 0, h - head, -0.05, 0.04, 0.04, minf(0.14, d * 0.35))
			_box(out, "body", 0, h - head * 0.6, -d * 0.12, w * 0.6, head * 0.8, d * 0.7)
			_cyl(out, "dark", "z", 0, h - head * 0.6, front + 0.02, minf(0.07, w * 0.4), minf(0.07, w * 0.4), 0.04)
			_box(out, "alert", w * 0.2, h - head * 0.25, -d * 0.3, 0.015, 0.015, 0.015)
		"chair":
			var seat := minf(0.48, h * 0.5)
			_box(out, "dark", 0, 0.03, 0, w * 0.9, 0.04, 0.06)
			_box(out, "dark", 0, 0.03, 0, 0.06, 0.04, d * 0.9)
			_cyl(out, "trim", "y", 0, 0.05 + (seat - 0.1) / 2.0, 0, 0.05, seat - 0.1, 0.05)
			_box(out, "body", 0, seat - 0.04, -0.02, w * 0.8, 0.08, d * 0.8)
			_box(out, "body", 0, seat + (h - seat) / 2.0, d / 2.0 - 0.05, w * 0.75, h - seat, 0.06)
			_box(out, "trim", 0, seat + 0.04, d / 2.0 - 0.09, 0.04, 0.16, 0.03)
			_box(out, "neon", 0, h - 0.03, d / 2.0 - 0.083, w * 0.6, N, 0.006)
		"cooler":
			var cab := h * 0.68
			_box(out, "body", 0, cab / 2.0, 0, w * 0.9, cab, d * 0.9)
			_box(out, "dark", 0, cab * 0.7, front + d * 0.05 - 0.002, w * 0.7, cab * 0.22, 0.004)
			_box(out, "dark", 0, cab * 0.62, front + d * 0.05 - minf(0.03, d * 0.1), w * 0.6, 0.02, minf(0.06, d * 0.2))
			for s: float in [-1.0, 1.0]:
				_box(out, "neon" if s < 0.0 else "alert", s * w * 0.15, cab * 0.72, front + d * 0.05 - 0.015, 0.03, 0.04, 0.03)
			_cyl(out, "trim", "y", 0, cab + 0.02, 0, w * 0.4, 0.04, d * 0.4)
			_cyl(out, "glass", "y", 0, cab + 0.04 + (h - cab - 0.04) / 2.0, 0, w * 0.9, h - cab - 0.04, d * 0.9)
		"plant":
			var pot := minf(0.35, h * 0.32)
			var fh := h - pot
			_cyl(out, "body", "y", 0, pot / 2.0, 0, w * 0.6, pot, d * 0.6)
			_cyl(out, "trim", "y", 0, pot - 0.01, 0, w * 0.64, 0.02, d * 0.64)
			_cyl(out, "neon", "y", 0, pot * 0.2, 0, w * 0.62, 0.012, d * 0.62)
			_box(out, "trim", 0, pot + fh * 0.25, 0, 0.03, fh * 0.5, 0.03)
			_box(out, "leaf", 0, pot + fh * 0.55, 0, w * 0.9, fh * 0.35, d * 0.9)
			_box(out, "leaf", w * 0.12, pot + fh * 0.8, -d * 0.08, w * 0.6, fh * 0.3, d * 0.6)
			_box(out, "leaf", -w * 0.08, pot + fh * 0.92, d * 0.06, w * 0.35, fh * 0.16, d * 0.35)
		"bin":
			_cyl(out, "body", "y", 0, h / 2.0, 0, w * 0.9, h, d * 0.9)
			_cyl(out, "trim", "y", 0, h - 0.016, 0, w, 0.03, d)
			_cyl(out, "dark", "y", 0, h - 0.001, 0, w * 0.82, 0.002, d * 0.82)
			_cyl(out, "neon", "y", 0, h * 0.55, 0, w * 0.92, 0.02, d * 0.92)
		"tube":
			_cyl(out, "dark", "y", 0, 0.025, 0, w, 0.05, d)
			_cyl(out, "trim", "y", 0, h - 0.02, 0, w * 0.6, 0.04, d * 0.6)
			_cyl(out, "neon", "y", 0, 0.05 + (h - 0.09) / 2.0, 0, w * 0.45, h - 0.09, d * 0.45)
		"stove":
			var top := 0.03
			var kick := minf(0.08, h * 0.1)
			var bh := h - top - kick - 0.004
			_box(out, "body", 0, kick + bh / 2.0, 0.01, w - 0.01, bh, d - 0.02)
			_box(out, "dark", 0, kick / 2.0, 0.03, w - 0.06, kick, d - 0.06)
			_box(out, "dark", 0, h - 0.004 - top / 2.0, 0, w, top, d)
			_box(out, "dark", 0, kick + bh * 0.42, front - 0.002, w * 0.78, bh * 0.56, 0.006)
			_box(out, "glass", 0, kick + bh * 0.42, front - 0.006, w * 0.6, bh * 0.3, 0.004)
			_box(out, "trim", 0, kick + bh * 0.8, front - 0.02, w * 0.7, 0.02, 0.02)
			for sx: float in [-1.0, 1.0]:
				for sz: float in [-1.0, 1.0]:
					_cyl(out, "flame" if sx < 0.0 and sz < 0.0 else "neon", "y", sx * w * 0.22, h - 0.002, sz * d * 0.22, w * 0.24, 0.004, w * 0.24)
			for i in 4:
				_cyl(out, "trim", "z", -w * 0.3 + (i * w * 0.6) / 3.0, kick + bh * 0.92, front - 0.012, 0.03, 0.03, 0.024)
		"microwave":
			var body := d * 0.76
			var bz := d / 2.0 - body / 2.0
			var f := bz - body / 2.0
			_box(out, "body", 0, h / 2.0, bz, w, h, body)
			_box(out, "dark", -w * 0.1, h / 2.0, f - 0.002, w * 0.66, h * 0.76, 0.006)
			_box(out, "alert", -w * 0.1, h / 2.0, f - 0.006, w * 0.42, h * 0.46, 0.002)
			_box(out, "flame", -w * 0.2, h * 0.28, f - 0.008, 0.012, h * 0.3, 0.002)
			_box(out, "flame", 0, h * 0.62, f - 0.008, w * 0.1, 0.01, 0.002)
			_box(out, "body", -w / 2.0 + 0.008, h * 0.45, f - (d - body) / 2.0, 0.016, h * 0.8, d - body)
			_box(out, "glass", -w / 2.0 + 0.018, h * 0.45, f - (d - body) / 2.0, 0.004, h * 0.5, (d - body) * 0.7)
			_box(out, "screen", w * 0.34, h * 0.8, f - 0.002, w * 0.2, h * 0.14, 0.004)
			for i in 3:
				_box(out, "alert" if i == 2 else "trim", w * 0.34, h * (0.58 - i * 0.14), f - 0.002, w * 0.16, h * 0.08, 0.004)
			_box(out, "neon", w * 0.34, h * 0.12, f - 0.002, w * 0.2, 0.012, 0.004)
		"toaster":
			_box(out, "body", 0, h * 0.45, 0, w, h * 0.9, d)
			_box(out, "dark", 0, h * 0.1, 0, w * 0.9, h * 0.1, d * 0.8)
			for z: float in [-1.0, 1.0]:
				_box(out, "flame", 0, h * 0.9 + 0.002, z * d * 0.2, w * 0.76, 0.004, d * 0.14)
			_box(out, "trim", w / 2.0 + 0.006, h * 0.6, 0, 0.012, h * 0.12, d * 0.2)
			_box(out, "neon", 0, h * 0.2, front - 0.002, w * 0.5, 0.01, 0.004)
		"fridge":
			var kick := minf(0.08, h * 0.06)
			var split := kick + (h - kick) * 0.32
			_box(out, "body", 0, kick + (h - kick) / 2.0, 0.01, w - 0.01, h - kick, d - 0.02)
			_box(out, "dark", 0, kick / 2.0, 0.03, w - 0.06, kick, d - 0.06)
			_box(out, "dark", 0, split, front - 0.002, w - 0.02, 0.012, 0.006)
			var grip := h * 0.16
			for y: float in [split - grip * 0.7, split + grip * 1.1]:
				_box(out, "trim", w / 2.0 - 0.07, y, front - 0.02, 0.025, grip, 0.025)
			_box(out, "neon", 0, h - 0.04, front - 0.002, w - 0.06, N, 0.006)
			_box(out, "alert", -w * 0.2, split + h * 0.17, front - 0.003, 0.05, 0.05, 0.004)
			_box(out, "trim", -w * 0.08, split + h * 0.25, front - 0.003, 0.09, 0.12, 0.004)
		"sink":
			var top := 0.03
			var deck := h * 0.84
			_box(out, "body", 0, (deck - top) / 2.0, 0, w, deck - top, d)
			_box(out, "trim", 0, deck - top / 2.0, 0, w, top, d)
			_box(out, "dark", 0, deck - 0.005, -d * 0.05, w * 0.7, 0.012, d * 0.6)
			_cyl(out, "trim", "y", 0, deck + (h - deck) / 2.0, d * 0.34, 0.03, h - deck, 0.03)
			_box(out, "trim", 0, h - 0.012, d * 0.24, 0.024, 0.024, d * 0.22)
			_box(out, "neon", 0, deck * 0.5, front - 0.002, w * 0.7, N, 0.006)
		"toilet":
			var tank := minf(0.2, d * 0.3)
			var seat := minf(0.42, h * 0.56)
			_box(out, "body", 0, seat + (h - seat) / 2.0, d / 2.0 - tank / 2.0, w * 0.9, h - seat, tank)
			_box(out, "trim", 0, h - 0.012, d / 2.0 - tank / 2.0, w * 0.94, 0.024, tank + 0.01)
			_box(out, "body", 0, seat * 0.4, d * 0.12, w * 0.5, seat * 0.8, d * 0.5)
			_cyl(out, "body", "y", 0, seat * 0.8, -d * 0.1, w * 0.92, seat * 0.4, (d - tank) * 0.92)
			_cyl(out, "trim", "y", 0, seat + 0.012, -d * 0.1, w * 0.96, 0.024, (d - tank) * 0.96)
			_cyl(out, "neon", "y", 0, seat + 0.026, -d * 0.1, w * 0.62, 0.004, (d - tank) * 0.62)
		"bathtub":
			var t := 0.06
			var rim := h * 0.78
			_box(out, "dark", 0, rim * 0.2, 0, w - t, rim * 0.4, d - t)
			for s: float in [-1.0, 1.0]:
				_box(out, "body", s * (w / 2.0 - t / 2.0), rim / 2.0, 0, t, rim, d)
				_box(out, "body", 0, rim / 2.0, s * (d / 2.0 - t / 2.0), w, rim, t)
				_box(out, "trim", s * (w / 2.0 - t / 2.0), rim - 0.01, 0, t, 0.02, d)
			_box(out, "neon", 0, rim * 0.42, 0, w - t - 0.02, 0.01, d - t - 0.02)
			_cyl(out, "trim", "y", 0, rim + (h - rim) / 2.0, d / 2.0 - t, 0.03, h - rim, 0.03)
			_box(out, "trim", 0, h - 0.012, d / 2.0 - t - 0.08, 0.024, 0.024, 0.16)
		"washer", "dryer":
			var panel := minf(0.14, h * 0.16)
			var r := minf(w, h - panel) * 0.68
			_box(out, "body", 0, h / 2.0, 0.005, w - 0.01, h, d - 0.01)
			_box(out, "dark", 0, h - panel / 2.0, front - 0.002, w - 0.04, panel - 0.02, 0.006)
			_box(out, "screen", w * 0.22 if id == "washer" else -w * 0.22, h - panel / 2.0, front - 0.006, w * 0.26, panel * 0.42, 0.003)
			_cyl(out, "trim", "z", -w * 0.28 if id == "washer" else w * 0.28, h - panel / 2.0, front - 0.012, panel * 0.5, panel * 0.5, 0.024)
			var cy := (h - panel) / 2.0
			_cyl(out, "trim", "z", 0, cy, front - 0.008, r, r, 0.016)
			_cyl(out, "dark", "z", 0, cy, front - 0.014, r * 0.84, r * 0.84, 0.01)
			_cyl(out, "glass" if id == "washer" else "flame", "z", 0, cy, front - 0.02, r * 0.62, r * 0.62, 0.004)
			_box(out, "neon", 0, h - panel - 0.012, front - 0.002, w * 0.7, 0.01, 0.004)
		"couch", "armchair":
			var seat := minf(0.45, h * 0.52)
			var arm := minf(0.18, w * 0.16)
			var back := minf(0.22, d * 0.26)
			var fz := (-back) / 2.0
			_box(out, "dark", 0, 0.04, 0.01, w - 0.06, 0.08, d - 0.08)
			_box(out, "body", 0, 0.08 + (seat - 0.2) / 2.0, 0, w, seat - 0.2, d)
			_box(out, "body", 0, seat + (h - seat) / 2.0 - 0.06, d / 2.0 - back / 2.0, w, h - seat + 0.12, back)
			for s: float in [-1.0, 1.0]:
				_box(out, "body", s * (w / 2.0 - arm / 2.0), seat * 0.62 + 0.04, 0, arm, seat * 1.24 - 0.08, d)
			var n := maxi(1, floori((w - 2.0 * arm) / 0.62 + 0.5))
			var cw := (w - 2.0 * arm) / n
			for i in n:
				_box(out, "trim", -w / 2.0 + arm + cw * (i + 0.5), seat - 0.06, fz, cw - 0.02, 0.12, d - back - 0.02)
			_box(out, "neon", 0, 0.1, front - 0.002, w - 0.1, N, 0.006)
		"bed":
			var frame := h * 0.4
			var top := h * 0.8
			var side_on := w >= d
			var hx := w / 2.0 - 0.04 if side_on else 0.0
			var hz := 0.0 if side_on else d / 2.0 - 0.04
			_box(out, "wood", 0, frame / 2.0, 0, w, frame, d)
			_box(out, "body", 0, frame + (top - frame) / 2.0, 0, w - 0.04, top - frame, d - 0.04)
			_box(out, "wood", hx, h / 2.0, hz, 0.08 if side_on else w, h, d if side_on else 0.08)
			_box(out, "neon", hx - (0.05 if side_on else 0.0), h * 0.92, hz - (0.0 if side_on else 0.05), 0.008 if side_on else w - 0.1, N, d - 0.1 if side_on else 0.008)
			for s: float in [-1.0, 1.0]:
				_box(out, "trim", hx - (0.3 if side_on else 0.0) + (0.0 if side_on else s * w * 0.22), top + (h - top) * 0.4, hz - (0.0 if side_on else 0.3) + (s * d * 0.22 if side_on else 0.0), 0.34 if side_on else w * 0.38, (h - top) * 0.8, d * 0.38 if side_on else 0.34)
		"tv":
			var leg := minf(0.35, h * 0.3)
			var sh := h - leg
			for sx: float in [-1.0, 1.0]:
				_box(out, "dark", sx * (w / 2.0 - 0.08), leg / 2.0, 0, 0.04, leg, d * 0.7)
			_box(out, "body", 0, leg + sh / 2.0, 0, w, sh, d)
			_box(out, "dark", -w * 0.1, leg + sh * 0.52, front - 0.002, w * 0.66, sh * 0.78, 0.006)
			_box(out, "screen", -w * 0.1, leg + sh * 0.52, front - 0.006, w * 0.56, sh * 0.64, 0.004)
			for i in 2:
				_cyl(out, "trim", "z", w * 0.34, leg + sh * (0.74 - i * 0.26), front - 0.012, 0.09, 0.09, 0.024)
			for i in 4:
				_box(out, "dark", w * 0.34, leg + sh * (0.34 - i * 0.05), front - 0.002, w * 0.16, 0.008, 0.004)
			_box(out, "neon", 0, leg + 0.02, front - 0.002, w - 0.06, 0.01, 0.004)
		"lamp":
			var shade := minf(0.36, h * 0.24)
			_cyl(out, "dark", "y", 0, 0.02, 0, w * 0.7, 0.04, d * 0.7)
			_cyl(out, "trim", "y", 0, (h - shade) / 2.0, 0, 0.03, h - shade, 0.03)
			_cyl(out, "body", "y", 0, h - shade / 2.0, 0, w, shade, d)
			_cyl(out, "flame", "y", 0, h - shade * 0.6, 0, w * 0.34, shade * 0.4, d * 0.34)
			_cyl(out, "neon", "y", 0, h - shade - 0.004, 0, w * 1.02, 0.008, d * 1.02)
		"fireplace":
			var mantel := minf(0.08, h * 0.08)
			var fh := (h - mantel) * 0.72
			_box(out, "body", 0, (h - mantel) / 2.0, 0, w, h - mantel, d)
			_box(out, "trim", 0, h - mantel / 2.0, -0.02, w + 0.02, mantel, d + 0.04)
			_box(out, "dark", 0, fh / 2.0 + 0.03, front - 0.002, w * 0.64, fh, 0.006)
			for s: float in [-1.0, 1.0]:
				_box(out, "wood", s * w * 0.1, 0.09, front - 0.01, w * 0.26, 0.05, 0.05)
			_box(out, "flame", -w * 0.08, 0.03 + fh * 0.27, front - 0.008, w * 0.1, fh * 0.42, 0.004)
			_box(out, "flame", w * 0.08, 0.03 + fh * 0.2, front - 0.008, w * 0.08, fh * 0.32, 0.004)
			_box(out, "alert", 0, 0.03 + fh * 0.1, front - 0.01, w * 0.2, fh * 0.14, 0.004)
			_box(out, "neon", 0, h - mantel - 0.012, front - 0.002, w - 0.06, N, 0.006)
		"bbq":
			var bowl := h * 0.72
			var r := minf(w, d)
			for leg: Array in [[-1.0, -1.0], [1.0, -1.0], [0.0, 1.0]]:
				_box(out, "dark", float(leg[0]) * r * 0.3, bowl * 0.4, float(leg[1]) * r * 0.3, 0.03, bowl * 0.8, 0.03)
			_cyl(out, "trim", "y", 0, bowl * 0.34, 0, r * 0.7, 0.012, r * 0.7)
			_cyl(out, "body", "y", 0, bowl * 0.8, 0, r * 0.84, bowl * 0.28, r * 0.84)
			_cyl(out, "body", "y", 0, bowl + (h - bowl) * 0.24, 0, r * 0.98, (h - bowl) * 0.48, r * 0.98)
			_cyl(out, "flame", "y", 0, bowl + 0.004, 0, r * 0.88, 0.008, r * 0.88)
			_cyl(out, "body", "y", 0, bowl + (h - bowl) * 0.62, 0, r * 0.66, (h - bowl) * 0.28, r * 0.66)
			_cyl(out, "trim", "y", 0, h - 0.02, 0, 0.12, 0.04, 0.12)
			_cyl(out, "neon", "y", 0, bowl - 0.01, 0, r + 0.004, 0.008, r + 0.004)
		"gnome":
			var r := minf(w, d)
			_cyl(out, "dark", "y", 0, h * 0.04, 0, r * 0.9, h * 0.08, r * 0.9)
			_cyl(out, "body", "y", 0, h * 0.26, 0, r * 0.8, h * 0.36, r * 0.8)
			_cyl(out, "trim", "y", 0, h * 0.5, 0, r * 0.66, h * 0.14, r * 0.66)
			_box(out, "trim", 0, h * 0.42, -r * 0.36, r * 0.4, h * 0.22, 0.03)
			_cyl(out, "neon", "y", 0, h * 0.2, 0, r * 0.84, 0.01, r * 0.84)
			_cyl(out, "alert", "y", 0, h * 0.62, 0, r * 0.68, h * 0.1, r * 0.68)
			_cyl(out, "alert", "y", 0, h * 0.72, 0, r * 0.46, h * 0.1, r * 0.46)
			_cyl(out, "alert", "y", 0, h * 0.82, 0, r * 0.28, h * 0.1, r * 0.28)
			_cyl(out, "alert", "y", 0, h * 0.93, 0, r * 0.12, h * 0.14, r * 0.12)
		"modular":
			var stand := minf(0.5, h * 0.3)
			var rows := maxi(2, floori((h - stand) / 0.36))
			var rh := (h - stand) / rows
			var cols := maxi(3, floori(w / 0.14))
			var cw := (w - 0.04) / cols
			for s: float in [-1.0, 1.0]:
				_box(out, "dark", s * (w / 2.0 - 0.06), stand / 2.0, 0, 0.04, stand, d * 0.8)
			_box(out, "body", 0, stand + (h - stand) / 2.0, 0.01, w, h - stand, d - 0.02)
			for r in rows:
				var y0 := stand + rh * r
				_box(out, "trim", 0, y0 + 0.008, front - 0.002, w - 0.02, 0.012, 0.004)
				for c in cols:
					var x := -w / 2.0 + 0.02 + cw * (c + 0.5)
					var i := r * cols + c
					_box(out, "dark", x, y0 + rh / 2.0, front - 0.002, cw - 0.012, rh - 0.03, 0.006)
					_cyl(out, "trim", "z", x, y0 + rh * 0.68, front - 0.012, 0.03, 0.03, 0.02)
					_cyl(out, "trim", "z", x, y0 + rh * 0.42, front - 0.01, 0.018, 0.018, 0.012)
					_box(out, "alert" if i % 5 == 2 else "neon", x + cw * 0.28, y0 + rh * 0.86, front - 0.006, 0.01, 0.01, 0.004)
					_box(out, "screen" if i % 7 == 3 else "dark", x, y0 + rh * 0.2, front - 0.008, cw * 0.5, 0.012, 0.004)
			for i in 4:
				var x := -w * 0.3 + i * w * 0.2
				var drop := (h - stand) * (0.3 + ((i * 3) % 4) * 0.12)
				_box(out, "neon" if i % 2 == 0 else "alert", x, h - 0.06 - drop / 2.0, front - 0.024, 0.008, drop, 0.008)
		"mixing":
			var top := 0.05
			var face := h - 0.024
			var n := maxi(4, floori(w / 0.11))
			var cw := (w - 0.08) / n
			for s: float in [-1.0, 1.0]:
				_box(out, "dark", s * (w / 2.0 - 0.05), (face - top) / 2.0, 0, 0.06, face - top, d - 0.06)
			_box(out, "body", 0, face - top / 2.0, 0, w, top, d)
			for i in n:
				var x := -w / 2.0 + 0.04 + cw * (i + 0.5)
				_box(out, "dark", x, face + 0.002, 0, cw - 0.012, 0.004, d - 0.06)
				_box(out, "trim", x, face + 0.008, -d * (0.1 + ((i * 5) % 4) * 0.08), cw * 0.5, 0.012, 0.03)
				for k in 3:
					_cyl(out, "trim", "y", x, face + 0.012, d * (0.1 + k * 0.1), 0.02, 0.02, 0.02)
				_box(out, "alert" if i % 6 == 4 else "neon", x, face + 0.006, d * 0.42, cw * 0.4, 0.004, 0.012)
		"speaker":
			var r := minf(w, h) * 0.72
			_box(out, "body", 0, h / 2.0, 0, w, h, d)
			_box(out, "dark", 0, h / 2.0, front - 0.002, w - 0.03, h - 0.03, 0.004)
			_cyl(out, "trim", "z", 0, h * 0.34, front - 0.006, r, r, 0.008)
			_cyl(out, "dark", "z", 0, h * 0.34, front - 0.012, r * 0.86, r * 0.86, 0.008)
			_cyl(out, "trim", "z", 0, h * 0.34, front - 0.016, r * 0.3, r * 0.3, 0.006)
			_cyl(out, "trim", "z", 0, h * 0.78, front - 0.006, r * 0.4, r * 0.4, 0.008)
			_cyl(out, "dark", "z", 0, h * 0.78, front - 0.012, r * 0.26, r * 0.26, 0.006)
			_box(out, "neon", 0, h * 0.6, front - 0.006, w * 0.6, 0.01, 0.004)
		"amp":
			var top := h - 0.024
			_box(out, "body", 0, top / 2.0, 0, w, top, d)
			_box(out, "trim", 0, top * 0.42, front - 0.002, w - 0.04, top * 0.66, 0.004)
			_box(out, "dark", 0, top * 0.42, front - 0.006, w - 0.07, top * 0.6, 0.004)
			_box(out, "dark", 0, top * 0.87, front - 0.002, w - 0.04, top * 0.18, 0.004)
			for i in 5:
				_cyl(out, "trim", "z", -w * 0.34 + i * w * 0.14, top * 0.87, front - 0.012, 0.03, 0.03, 0.02)
			_cyl(out, "alert", "z", w * 0.38, top * 0.87, front - 0.008, 0.024, 0.024, 0.01)
			_box(out, "trim", 0, h - 0.012, 0, w * 0.3, 0.024, 0.03)
			_box(out, "neon", 0, top * 0.05, front - 0.002, w * 0.6, 0.008, 0.004)
		"turntable":
			var r := minf(w, d) * 0.84
			_box(out, "body", 0, h * 0.3, 0, w, h * 0.6, d)
			_box(out, "trim", 0, h * 0.64, 0, w, h * 0.08, d)
			_cyl(out, "trim", "y", -w * 0.1, h * 0.72, 0, r, h * 0.08, r)
			_cyl(out, "dark", "y", -w * 0.1, h * 0.78, 0, r * 0.94, h * 0.04, r * 0.94)
			_cyl(out, "alert", "y", -w * 0.1, h * 0.81, 0, r * 0.3, h * 0.02, r * 0.3)
			_cyl(out, "trim", "y", w * 0.36, h * 0.82, -d * 0.34, 0.03, h * 0.36, 0.03)
			_box(out, "trim", w * 0.2, h * 0.94, -d * 0.1, 0.012, h * 0.08, d * 0.5)
			_box(out, "neon", w * 0.34, h * 0.3, front - 0.002, w * 0.2, 0.008, 0.004)
		"piano":
			var keys := minf(0.72, h * 0.58)
			var bed := minf(0.28, d * 0.46)
			_box(out, "body", 0, h / 2.0, d / 2.0 - (d - bed) / 2.0, w, h, d - bed)
			_box(out, "body", 0, keys - 0.04, -d / 2.0 + bed / 2.0, w, 0.08, bed)
			for s: float in [-1.0, 1.0]:
				_box(out, "body", s * (w / 2.0 - 0.03), keys / 2.0 - 0.04, -d / 2.0 + bed * 0.7, 0.06, keys - 0.08, 0.06)
			_box(out, "trim", 0, keys + 0.002, -d / 2.0 + bed / 2.0, w - 0.12, 0.008, bed - 0.06)
			var n := maxi(8, floori((w - 0.12) / 0.06))
			var kw := (w - 0.12) / n
			for i in n:
				if i % 7 != 2 and i % 7 != 6:
					_box(out, "dark", -w / 2.0 + 0.06 + kw * (i + 0.5) + kw / 2.0, keys + 0.012, -d / 2.0 + bed * 0.62, kw * 0.5, 0.012, bed * 0.5)
			_box(out, "neon", 0, keys + 0.06, -d / 2.0 + bed - 0.002, w - 0.14, N, 0.006)
		"arcade":
			var deck := minf(0.95, h * 0.54)
			var marquee := minf(0.2, h * 0.12)
			_box(out, "body", 0, h / 2.0, d * 0.15, w, h, d * 0.7)
			_box(out, "body", 0, deck - 0.1, front + d * 0.11, w * 0.94, 0.14, d * 0.22)
			_box(out, "body", 0, (deck - 0.17) / 2.0, front + d * 0.11, w * 0.94, deck - 0.17, d * 0.22)
			_box(out, "dark", 0, deck - 0.02, front + d * 0.11, w * 0.86, 0.016, d * 0.18)
			_cyl(out, "trim", "y", -w * 0.22, deck + 0.04, front + d * 0.11, 0.02, 0.08, 0.02)
			_cyl(out, "alert", "y", -w * 0.22, deck + 0.09, front + d * 0.11, 0.04, 0.03, 0.04)
			for i in 3:
				_cyl(out, "neon" if i == 1 else "alert", "y", w * (0.04 + i * 0.12), deck + 0.002, front + d * 0.11, 0.04, 0.012, 0.04)
			_box(out, "dark", 0, deck + (h - marquee - deck) / 2.0, -d * 0.2 - 0.002, w * 0.84, h - marquee - deck - 0.04, 0.006)
			_box(out, "screen", 0, deck + (h - marquee - deck) / 2.0, -d * 0.2 - 0.006, w * 0.72, (h - marquee - deck) * 0.76, 0.004)
			_box(out, "neon", 0, h - marquee / 2.0, -d * 0.2 - 0.004, w * 0.86, marquee * 0.7, 0.008)
		"teatable":
			var th := h * 0.76
			var r := h - th
			_add(out, parts_of("table", w, th, d), 0, 0, 0)
			_box(out, "body", 0, th - 0.01, 0, w * 0.96, 0.03, d)
			var n := maxi(2, floori(w / 0.5))
			var cw := (w * 0.86) / n
			for i in n:
				var x := -w * 0.43 + cw * (i + 0.5)
				for s: float in [-1.0, 1.0]:
					var z := s * d * 0.3
					_cyl(out, "trim", "y", x, th + 0.012, z, r * 0.8, 0.012, r * 0.8)
					_cyl(out, "neon" if i % 3 == 1 else "body", "y", x, th + r * 0.2, z, r * 0.36, r * 0.3, r * 0.36)
					_box(out, "body", x + r * 0.22, th + r * 0.2, z, r * 0.14, r * 0.18, 0.01)
				if i % 2 == 0:
					_add(out, parts_of("teapot", r * 1.2, r * 0.95, r * 0.9), x, th + 0.01, 0)
				else:
					_cyl(out, "alert", "y", x, th + r * 0.18, 0, r, r * 0.26, r)
					_cyl(out, "body", "y", x, th + r * 0.4, 0, r * 0.8, r * 0.18, r * 0.8)
		"teapot":
			var r := minf(w * 0.62, d)
			_cyl(out, "body", "y", 0, h * 0.44, 0, r * 0.8, h * 0.2, r * 0.8)
			_cyl(out, "body", "y", 0, h * 0.26, 0, r, h * 0.3, r)
			_cyl(out, "body", "y", 0, h * 0.08, 0, r * 0.7, h * 0.16, r * 0.7)
			_cyl(out, "trim", "y", 0, h * 0.58, 0, r * 0.56, h * 0.06, r * 0.56)
			_cyl(out, "neon", "y", 0, h * 0.7, 0, 0.03, h * 0.12, 0.03)
			_box(out, "body", -w * 0.38, h * 0.36, 0, w * 0.24, 0.03, 0.03)
			_box(out, "body", -w * 0.47, h * 0.46, 0, 0.03, h * 0.16, 0.03)
			_box(out, "trim", w * 0.4, h * 0.46, 0, w * 0.04, h * 0.3, 0.02)
			_box(out, "trim", w * 0.34, h * 0.6, 0, w * 0.14, 0.02, 0.02)
			_box(out, "trim", w * 0.34, h * 0.3, 0, w * 0.14, 0.02, 0.02)
		"clock":
			var base := h * 0.26
			var head := minf(w, h * 0.3)
			_box(out, "body", 0, base / 2.0, 0, w, base, d)
			_box(out, "body", 0, base + (h - base - head) / 2.0, 0.01, w * 0.72, h - base - head, d * 0.8)
			_box(out, "body", 0, h - head / 2.0, 0, w, head, d)
			_box(out, "trim", 0, h - 0.015, 0, w + 0.02, 0.03, d + 0.02)
			_box(out, "dark", 0, base + (h - base - head) / 2.0, front + d * 0.1 - 0.002, w * 0.5, (h - base - head) * 0.8, 0.006)
			_cyl(out, "trim", "y", 0, base + (h - base - head) * 0.55, front + d * 0.1 - 0.012, 0.012, (h - base - head) * 0.46, 0.012)
			_cyl(out, "flame", "z", 0, base + (h - base - head) * 0.3, front + d * 0.1 - 0.012, w * 0.22, w * 0.22, 0.012)
			_cyl(out, "trim", "z", 0, h - head / 2.0, front - 0.004, head * 0.84, head * 0.84, 0.01)
			_cyl(out, "body", "z", 0, h - head / 2.0, front - 0.012, head * 0.76, head * 0.76, 0.006)
			_box(out, "dark", 0, h - head * 0.36, front - 0.018, 0.012, head * 0.28, 0.004)
			_box(out, "alert", head * 0.14, h - head * 0.56, front - 0.02, head * 0.3, 0.012, 0.004)
			_box(out, "neon", 0, base - 0.02, front - 0.002, w * 0.7, N, 0.006)
		"mushroom":
			var r := minf(w, d)
			var stem := h * 0.56
			_cyl(out, "trim", "y", 0, stem / 2.0, 0, r * 0.26, stem, r * 0.26)
			_cyl(out, "alert", "y", 0, stem + h * 0.06, 0, r, h * 0.12, r)
			_cyl(out, "alert", "y", 0, stem + h * 0.17, 0, r * 0.8, h * 0.1, r * 0.8)
			_cyl(out, "alert", "y", 0, stem + h * 0.27, 0, r * 0.52, h * 0.1, r * 0.52)
			_cyl(out, "alert", "y", 0, stem + h * 0.37, 0, r * 0.24, h * 0.08, r * 0.24)
			for i in 5:
				var a := i * 1.257
				_cyl(out, "body", "y", cos(a) * r * 0.32, stem + h * (0.12 if i % 2 == 0 else 0.22) + 0.04, sin(a) * r * 0.32, r * 0.14, 0.01, r * 0.14)
			_cyl(out, "neon", "y", 0, stem - h * 0.02, 0, r * 0.96, 0.01, r * 0.96)
		"bottle":
			var r := minf(w, d)
			_cyl(out, "glass", "y", 0, h * 0.3, 0, r, h * 0.6, r)
			_cyl(out, "neon", "y", 0, h * 0.2, 0, r * 0.82, h * 0.34, r * 0.82)
			_cyl(out, "glass", "y", 0, h * 0.72, 0, r * 0.4, h * 0.24, r * 0.4)
			_cyl(out, "wood", "y", 0, h * 0.91, 0, r * 0.44, h * 0.14, r * 0.44)
			_box(out, "body", 0, h * 0.34, -r / 2.0 - 0.002, r * 0.8, h * 0.26, 0.002)
		"door":
			var frame := minf(0.08, w * 0.1)
			_box(out, "dark", 0, (h - frame) / 2.0, 0, w - 2.0 * frame, h - frame, d * 0.7)
			for s: float in [-1.0, 1.0]:
				_box(out, "body", s * (w / 2.0 - frame / 2.0), h / 2.0, 0, frame, h, d)
			_box(out, "body", 0, h - frame / 2.0, 0, w, frame, d)
			_box(out, "trim", w / 2.0 - frame - 0.08, h * 0.48, front + d * 0.15 - 0.02, 0.05, 0.05, 0.04)
			_box(out, "neon", 0, 0.006, front - 0.002, w - 2.0 * frame, 0.012, 0.012)
		"spiral":
			var r := minf(w, d) / 2.0
			var n := maxi(6, floori(h / 0.2))
			_cyl(out, "trim", "y", 0, h / 2.0, 0, 0.1, h, 0.1)
			for i in n:
				var a := i * 0.7854
				var y := 0.18 + i * ((h - 0.2) / n)
				_box(out, "body", sin(a) * r * 0.55, y, -cos(a) * r * 0.55, absf(sin(a)) * r * 0.5 + 0.22, 0.03, absf(cos(a)) * r * 0.5 + 0.22)
			_cyl(out, "neon", "y", 0, h - 0.04, 0, 0.14, 0.08, 0.14)
		"mirror":
			var frame := minf(0.07, w * 0.1)
			_box(out, "body", 0, h / 2.0, 0, w, h, d * 0.7)
			_box(out, "glass", 0, h / 2.0, front + d * 0.15 - 0.002, w - 2.0 * frame, h - 2.0 * frame, 0.004)
			_box(out, "dark", w * 0.12, h * 0.6, front + d * 0.15 - 0.005, 0.006, h * 0.5, 0.002)
			_box(out, "dark", w * 0.04, h * 0.48, front + d * 0.15 - 0.005, w * 0.3, 0.006, 0.002)
			_box(out, "neon", 0, h - frame * 0.5, front + d * 0.15 - 0.003, w - 0.04, N, 0.004)
		"hole":
			var r := minf(w, d)
			_cyl(out, "neon", "y", 0, h * 0.2, 0, r, h * 0.4, r)
			_cyl(out, "body", "y", 0, h * 0.5, 0, r * 0.97, h * 0.4, r * 0.97)
			_cyl(out, "dark", "y", 0, h * 0.8, 0, r * 0.86, h * 0.4, r * 0.86)
		"card":
			var bh := h * 0.68
			_box(out, "body", 0, h - bh / 2.0 - 0.1, 0, w, bh, d * 0.5)
			for s: float in [-1.0, 1.0]:
				_box(out, "dark", s * w * 0.2, (h - bh - 0.1) / 2.0, 0, 0.05, h - bh - 0.1, 0.05)
				_box(out, "alert", s * w * 0.32, h - 0.2 - (0.0 if s < 0.0 else bh * 0.72), front + d * 0.25 - 0.002, w * 0.12, w * 0.12, 0.004)
			_box(out, "alert", 0, h - bh / 2.0 - 0.1, front + d * 0.25 - 0.002, w * 0.3, bh * 0.3, 0.004)
			_cyl(out, "body", "y", 0, h - 0.06, 0, minf(0.16, d + 0.08), 0.12, minf(0.16, d + 0.08))
			_box(out, "trim", w / 2.0 + 0.015, h / 2.0, 0, 0.02, h, 0.02)
			_box(out, "neon", w / 2.0 + 0.015, h - 0.04, 0, 0.04, 0.08, 0.04)
		"flamingo":
			var bh := h * 0.56
			_cyl(out, "dark", "y", 0, 0.01, 0, w * 0.6, 0.02, w * 0.6)
			_cyl(out, "neon", "y", 0, bh / 2.0, 0, 0.016, bh, 0.016)
			_cyl(out, "body", "z", 0, bh + 0.08, d * 0.08, w * 0.5, 0.18, d * 0.62)
			_box(out, "body", 0, bh + 0.18, -d * 0.16, 0.05, 0.05, d * 0.2)
			_cyl(out, "neon", "y", 0, bh + (h - bh) * 0.62, -d * 0.26, 0.03, (h - bh) * 0.6, 0.03)
			_box(out, "body", 0, h - 0.05, -d * 0.32, 0.07, 0.07, d * 0.2)
			_box(out, "dark", 0, h - 0.07, -d * 0.48, 0.03, 0.03, d * 0.1)
	return out
