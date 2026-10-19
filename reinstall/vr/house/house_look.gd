## The Web-1.0 look, shared by the house, the lobby and the effects: teal
## tiled walls, checkerboard floors, starfield ceilings, gold for anything
## that matters (rails, the trail, the duck). Every texture is drawn
## procedurally into an [ImageTexture] (no imported assets, nothing to
## compress), filtered NEAREST for the chunky 1997 pixels. Materials are
## per-vertex lit — cheap on the Quest's tiler, and enough light to read
## corners.
class_name HouseLook
extends RefCounted

const TEAL := Color("#0f8a8a")
const TEAL_DARK := Color("#064c4c")
const TEAL_GLOW := Color("#3df2e8")
const GOLD := Color("#f2c230")
const GOLD_DEEP := Color("#c8961a")
const NIGHT := Color("#050a1a")
const FOG := Color("#0a2a33")
const INK := Color("#e8fbff")

static var _materials := {}
static var _textures := {}


## A cached material by key, built once by `make`.
static func _cached(key: String, make: Callable) -> Material:
	if not _materials.has(key):
		_materials[key] = make.call()
	return _materials[key]


static func _lit(albedo: Color, tex: Texture2D = null) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	m.roughness = 1.0
	m.albedo_color = albedo
	if tex != null:
		m.albedo_texture = tex
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
	return m


static func _unshaded(albedo: Color, tex: Texture2D = null) -> StandardMaterial3D:
	var m := _lit(albedo, tex)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return m


# --- textures --------------------------------------------------------------


static func _texture(key: String, make: Callable) -> ImageTexture:
	if not _textures.has(key):
		var img: Image = make.call()
		img.generate_mipmaps()
		_textures[key] = ImageTexture.create_from_image(img)
	return _textures[key]


## 2×2 checks per tile.
static func checker(a: Color, b: Color) -> ImageTexture:
	return _texture("checker:%s:%s" % [a.to_html(), b.to_html()], func() -> Image:
		var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
		for y in 32:
			for x in 32:
				img.set_pixel(x, y, a if ((x / 16) + (y / 16)) % 2 == 0 else b)
		return img)


## A bevelled tile: light top/left edge, dark bottom/right edge.
static func tile() -> ImageTexture:
	return _texture("tile", func() -> Image:
		var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
		for y in 32:
			for x in 32:
				var c := Color(1, 1, 1)
				if x == 0 or y == 0:
					c = Color(1.25, 1.25, 1.25)
				elif x == 31 or y == 31:
					c = Color(0.6, 0.6, 0.6)
				img.set_pixel(x, y, c.clamp())
		return img)


## Night sky: scattered white and teal stars (deterministic).
static func starfield() -> ImageTexture:
	return _texture("stars", func() -> Image:
		var img := Image.create(128, 128, false, Image.FORMAT_RGBA8)
		img.fill(NIGHT)
		var rng := RandomNumberGenerator.new()
		rng.seed = 1997
		for i in 90:
			var c := INK if i % 4 != 0 else TEAL_GLOW
			c.a = 1.0
			img.set_pixel(rng.randi_range(0, 127), rng.randi_range(0, 127), c.darkened(rng.randf_range(0.0, 0.6)))
		return img)


## A fence lattice: diagonal wires, holes cut by alpha.
static func lattice() -> ImageTexture:
	return _texture("lattice", func() -> Image:
		var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
		img.fill(Color(0, 0, 0, 0))
		for y in 32:
			for x in 32:
				if (x + y) % 16 <= 1 or (x - y + 32) % 16 <= 1 or y <= 1:
					img.set_pixel(x, y, Color(1, 1, 1, 1))
		return img)


## Step stripes for a ramp (the V coordinate runs up the ramp).
static func steps() -> ImageTexture:
	return _texture("steps", func() -> Image:
		var img := Image.create(8, 32, false, Image.FORMAT_RGBA8)
		for y in 32:
			for x in 8:
				img.set_pixel(x, y, GOLD_DEEP if y < 4 else Color("#3a2c1a"))
		return img)


# --- materials ---------------------------------------------------------------


static func wall() -> Material:
	return _cached("wall", func() -> Material: return _lit(TEAL, tile()))


static func lintel() -> Material:
	return _cached("lintel", func() -> Material: return _lit(TEAL_DARK, tile()))


static func fence() -> Material:
	return _cached("fence", func() -> Material:
		var m := _lit(Color("#9fb7c0"), lattice())
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = 0.5
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		return m)


## Stair rails: the fence lattice in gold, so the hole stays visible.
static func rail() -> Material:
	return _cached("rail", func() -> Material:
		var m := _lit(GOLD, lattice())
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = 0.5
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		return m)


## A room's checkerboard floor, tinted by its `color` (outdoor: lawn).
static func floor_for(color: Variant, outdoor: bool) -> Material:
	var base: Color = Color(str(color)) if color is String and str(color).begins_with("#") else (Color("#2f6b3a") if outdoor else Color("#8a8f99"))
	return _cached("floor:%s" % base.to_html(), func() -> Material:
		return _lit(Color.WHITE, checker(base.lightened(0.15), base.darkened(0.3))))


static func ceiling() -> Material:
	return _cached("ceiling", func() -> Material: return _unshaded(Color.WHITE, starfield()))


static func ground() -> Material:
	return _cached("ground", func() -> Material: return _lit(Color.WHITE, checker(Color("#123d2a"), Color("#0b2a1d"))))


static func ramp() -> Material:
	return _cached("ramp", func() -> Material:
		var m := _lit(Color.WHITE, steps())
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		return m)


## A flat prop colour.
static func paint(color: Variant, fallback := Color("#8a8f99")) -> Material:
	var c: Color = Color(str(color)) if color is String and str(color).begins_with("#") else fallback
	return _cached("paint:%s" % c.to_html(), func() -> Material: return _lit(c))


## A glowing screen (terminals, `screen` props).
static func screen(color: Variant = null) -> Material:
	var c: Color = Color(str(color)) if color is String and str(color).begins_with("#") else TEAL_GLOW
	return _cached("screen:%s" % c.to_html(), func() -> Material:
		var m := _unshaded(c)
		m.emission_enabled = true
		m.emission = c
		return m)


## Unshaded gold that glows — the trail, the duck's halo.
static func glow_gold() -> Material:
	return _cached("glow-gold", func() -> Material:
		var m := _unshaded(GOLD)
		m.emission_enabled = true
		m.emission = GOLD
		return m)


## The duck's body: shiny gilded, lit so it reads as round.
static func gilded() -> Material:
	return _cached("gilded", func() -> Material:
		var m := StandardMaterial3D.new()
		m.albedo_color = GOLD
		m.metallic = 0.8
		m.roughness = 0.3
		m.emission_enabled = true
		m.emission = GOLD_DEEP
		m.emission_energy_multiplier = 0.35
		return m)


## The King's health bar, Win98 progress-bar style: a sunken grey frame
## (dark top/left, white bottom/right) and navy blocks for the points left —
## `hp` of `max`, empty at 0. Not cached: it changes with every hit.
static func health_bar(hp: int, max_hp: int) -> Image:
	var w := 100
	var h := 12
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	img.fill(Color("#c0c0c0"))
	for x in w:
		img.set_pixel(x, 0, Color("#808080"))
		img.set_pixel(x, h - 1, Color.WHITE)
	for y in h:
		img.set_pixel(0, y, Color("#808080"))
		img.set_pixel(w - 1, y, Color.WHITE)
	var inner := w - 4
	var filled := int(round(inner * clampf(float(hp) / float(maxi(1, max_hp)), 0.0, 1.0)))
	# Blocks 6 px wide with a 1 px gap, as a Win98 progress bar draws them.
	var x := 2
	while x < 2 + filled:
		var bw := mini(6, 2 + filled - x)
		img.fill_rect(Rect2i(x, 2, bw, h - 4), Color("#000080"))
		x += 7
	return img


## A [Label3D] in the house's type.
static func label(text: String, height := 0.18, color := INK) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font_size = 64
	l.outline_size = 12
	l.pixel_size = height / 64.0
	l.modulate = color
	l.outline_modulate = Color(0, 0, 0, 0.85)
	l.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	return l


## The world environment: night background, teal fog, soft ambient light.
static func environment() -> Environment:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = NIGHT
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("#9fd8e0")
	env.ambient_light_energy = 0.55
	env.fog_enabled = true
	env.fog_light_color = FOG
	env.fog_density = 0.035
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	return env
