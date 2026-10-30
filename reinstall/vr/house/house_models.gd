## Prop models (wave 47) — the literal port of `@loom/house` `models.ts`,
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
}
const PART_ROLES := ["body", "trim", "dark", "neon", "screen", "glass", "leaf", "alert"]

const WHITE := "#f2f5f8"
const CYAN := "#29f4ff"
const MAGENTA := "#ff2bd6"
const VIOLET := "#8a5cff"
const BLUE := "#2b6cff"
const LIME := "#7dff3a"
const RED := "#ff2a4a"

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
## Neon is drawn this many times its colour (unlit, unfogged), so it glows.
const NEON_GAIN := 2.2
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
	return out
