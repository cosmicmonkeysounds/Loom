## The Web-1.0 look, shared by the house, the lobby and the effects: teal
## tiled walls, checkerboard floors, starfield ceilings, gold for anything
## that matters (rails, the trail, the duck). Every texture is drawn
## procedurally into an [ImageTexture] (no imported assets, nothing to
## compress), filtered NEAREST for the chunky 1997 pixels. Materials are
## Lambert-lit with no specular: per pixel on the `medium` and `high`
## graphics tiers (wave 39: the real house's lights pool on the walls and
## floors, [HouseLamps]), per vertex on `low` — cheapest on the Quest's
## tiler, and enough light to read corners. [method set_tier] picks it
## before anything is built. Wave 47 adds the props' clean glossy roles
## ([method role]), the shared flickering neon ([method neon]), the haze
## sheets and a violet, height-thickened fog ([method environment]).
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
## Per-pixel lighting ([method set_tier]); per vertex on `low`.
static var per_pixel := true
## The graphics tier [method set_tier] took (wave 47: the haze sheets' count).
static var tier := HouseLights.DEFAULT_TIER


## Take a graphics tier before the house, the lobby and the intro are
## built: `low` lights per vertex. Clears the cached materials when it
## changes (what is already built keeps its own).
static func set_tier(t: String) -> void:
	tier = HouseLights.tier_of(t)
	var pp := tier != "low"
	if pp != per_pixel:
		per_pixel = pp
		_materials.clear()


## A cached material by key, built once by `make`.
static func _cached(key: String, make: Callable) -> Material:
	if not _materials.has(key):
		_materials[key] = make.call()
	return _materials[key]


static func _lit(albedo: Color, tex: Texture2D = null) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL if per_pixel else BaseMaterial3D.SHADING_MODE_PER_VERTEX
	m.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT
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


# --- wave 47: models, neon, haze ---------------------------------------------


## A clean lit surface for the prop models: glossy, a little specular (per
## vertex on `low`). `vertex` takes its colour from the mesh (the bodies).
static func _gloss(albedo: Color, roughness: float, metallic := 0.0, vertex := false) -> StandardMaterial3D:
	var m := _lit(albedo)
	m.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
	m.diffuse_mode = BaseMaterial3D.DIFFUSE_BURLEY
	m.roughness = roughness
	m.metallic = metallic
	m.metallic_specular = 0.6
	if vertex:
		m.vertex_color_use_as_albedo = true
		m.vertex_color_is_srgb = true
	return m


## The material a model part's role is drawn in ([constant HouseModels.PART_ROLES]):
## `body` white plastic coloured per vertex (the prop's colour), `trim`
## chrome, `dark` black gloss, `neon` the shared neon ([method neon]),
## `screen` / `alert` / `flame` lit from inside, `glass`, `leaf` plastic,
## `wood` (wave 49) a duller gloss.
static func role(r: String) -> Material:
	match r:
		"body":
			return _cached("role:body", func() -> Material: return _gloss(BODY_TINT, 0.35, 0.0, true))
		"trim":
			return _cached("role:trim", func() -> Material: return _gloss(Color(HouseModels.ROLE_COLORS["trim"]), 0.22, 0.55))
		"dark":
			return _cached("role:dark", func() -> Material: return _gloss(Color(HouseModels.ROLE_COLORS["dark"]), 0.18))
		"neon":
			return neon()
		"screen", "alert", "flame":
			# [constant HouseModels.GLOW_ROLES]: lit from inside.
			return _cached("role:%s" % r, func() -> Material:
				var c := Color(HouseModels.ROLE_COLORS[r])
				var m := _unshaded(c)
				m.disable_fog = r != "screen"
				return m)
		"wood":
			return _cached("role:wood", func() -> Material: return _gloss(Color(HouseModels.ROLE_COLORS["wood"]), 0.55))
		"glass":
			return _cached("role:glass", func() -> Material: return _gloss(Color(HouseModels.ROLE_COLORS["glass"]), 0.06))
		"leaf":
			return _cached("role:leaf", func() -> Material: return _gloss(Color(HouseModels.ROLE_COLORS["leaf"]), 0.3))
	return paint(null)


## The neon: unlit, its colour per vertex times [constant HouseModels.NEON_GAIN],
## never fogged (it cuts through the haze), shared by every strip and model
## part so one [method set_neon] flickers it all.
static func neon() -> StandardMaterial3D:
	return _cached("neon", func() -> Material:
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.vertex_color_use_as_albedo = true
		m.vertex_color_is_srgb = true
		m.albedo_color = Color(HouseModels.NEON_GAIN, HouseModels.NEON_GAIN, HouseModels.NEON_GAIN)
		m.disable_fog = true
		return m) as StandardMaterial3D


## (wave 49) The Hallway's walls: a dim grey tile, only ever lit by the one
## light that follows the player ([Hallway]).
static func hallway() -> Material:
	return _cached("hallway", func() -> Material: return _lit(Color("#6a6f7a"), tile()))


## The neon at `level` (0 … 1, [method HouseModels.neon_flicker]).
static func set_neon(level: float) -> void:
	var g := HouseModels.NEON_GAIN * level
	neon().albedo_color = Color(g, g, g)


## A soft tiling noise (white, alpha = the noise), made once.
static func haze_texture() -> ImageTexture:
	if not _textures.has("haze"):
		var noise := FastNoiseLite.new()
		noise.seed = 1997
		noise.noise_type = FastNoiseLite.TYPE_PERLIN
		noise.frequency = 0.035
		noise.fractal_octaves = 3
		var src := noise.get_seamless_image(128, 128)
		var img := Image.create(128, 128, false, Image.FORMAT_RGBA8)
		for y in 128:
			for x in 128:
				var v := clampf((src.get_pixel(x, y).r - 0.3) / 0.5, 0.0, 1.0)
				img.set_pixel(x, y, Color(1, 1, 1, HAZE_ALPHA[0] + (HAZE_ALPHA[1] - HAZE_ALPHA[0]) * v))
		img.generate_mipmaps()
		_textures["haze"] = ImageTexture.create_from_image(img)
	return _textures["haze"]


## A haze sheet's material (its own: each drifts its UVs): additive, unlit,
## seen from both sides, at `opacity`.
static func haze_sheet(opacity: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.disable_fog = true
	m.disable_receive_shadows = true
	m.albedo_color = Color(Color(HouseModels.HAZE_COLOR), opacity)
	m.albedo_texture = haze_texture()
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	return m


## The King: gold that shines.
static func king_gold(color: Variant) -> Material:
	var c: Color = Color(str(color)) if color is String and str(color).begins_with("#") else GOLD
	return _cached("king:%s" % c.to_html(), func() -> Material:
		# Metal with nothing to reflect reads dark: half metal, lit a little from within.
		var m := _gloss(c, 0.3, 0.45)
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = 0.45
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


## The haze's fog (wave 47): its colour (the background too), the density
## per metre, and the height under which it thickens (house y) and by how much.
const HAZE := Color(HouseModels.HAZE_FOG)
const FOG_DENSITY := 0.05
const FOG_HEIGHT := 0.6
const FOG_HEIGHT_DENSITY := 0.25


## White plastic is drawn a little under white (the web's neon-mode body
## tint), so a lit body stays under the glow's threshold on `high`.
const BODY_TINT := Color(0.78, 0.8, 0.84)
## The haze texture's alpha between its thinnest and its thickest blobs.
const HAZE_ALPHA := [0.18, 0.48]


## The tone map's white point (ACES): the Mobile renderer's HDR buffer tops
## out near 2, so anything brighter — a bulb, a screen — rolls off into it.
const TONEMAP_WHITE := 2.0
const TONEMAP_EXPOSURE := 1.0


## The world environment: night background, teal fog, soft ambient light,
## and (wave 39) the picture for a graphics tier ([method HouseLights.tier_of]):
## an ACES (filmic) tone map on every tier, and glow — the bulbs, the
## screens, the trail and the duck bloom — on `high` only. Quest 3 holds its
## frame rate on `medium`: no glow, no SSAO / SSR / SSIL / volumetric fog
## on any tier (the Mobile renderer has none of them to spare).
static func environment(tier := HouseLights.DEFAULT_TIER) -> Environment:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = HAZE
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = HouseLights.DAY_COLOR
	env.ambient_light_energy = HouseLights.DAY_AMBIENT
	# Wave 47: the haze. Plain exponential depth fog (cheap on the Mobile
	# renderer: no volumetric fog) in the violet night, read like three's
	# FogExp2 at HouseModels.HAZE_FOG_DENSITY, and thicker near the floor.
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_light_color = HAZE
	env.fog_light_energy = 1.0
	env.fog_density = FOG_DENSITY
	env.fog_height = FOG_HEIGHT
	env.fog_height_density = FOG_HEIGHT_DENSITY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_white = TONEMAP_WHITE
	env.tonemap_exposure = TONEMAP_EXPOSURE
	env.glow_enabled = HouseLights.tier_of(tier) == "high"
	if env.glow_enabled:
		env.glow_intensity = 0.9
		env.glow_strength = 1.0
		env.glow_bloom = 0.05
		env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SCREEN
		env.glow_hdr_threshold = 0.7
		env.glow_hdr_scale = 2.0
	return env


## The 3D anti-aliasing for a tier: 2× MSAA on `high` only. (2× on `medium`
## drew a black void on the Quest 3, with only the text showing, on
## 2026-10-29: leave `medium` without until a build proves otherwise.)
static func msaa(tier := HouseLights.DEFAULT_TIER) -> Viewport.MSAA:
	return Viewport.MSAA_2X if HouseLights.tier_of(tier) == "high" else Viewport.MSAA_DISABLED
