## Guests' profile pictures for the ghosts (`GET /e/<event>/api/avatar/<key>`):
## its own pool of [constant POOL] [HTTPRequest]s (never the JSON
## transport, never on the frame loop — a request lands on its own signal),
## bodies capped at [constant MAX_BYTES], one request per URL in flight,
## every picture cached by URL for as long as the app runs, and a failure
## (an error, a 404, a picture Godot can't decode) remembered and never
## retried — that ghost just stays a capsule.
##
## Decoded by magic bytes ([method decode]): PNG, JPEG, WebP, SVG (rendered
## near 256 px). GIF and AVIF have no Godot decoder: they fail. Each picture
## becomes a Win98-bevelled square tile ([method tile_of]) with mipmaps, so
## it doesn't shimmer at a distance.
class_name AvatarCache
extends Node

## A picture landed (`texture` the tile), for everyone waiting on `url`.
signal loaded(url: String, texture: Texture2D)

const POOL := 2
const MAX_BYTES := 2 * 1024 * 1024
const TIMEOUT := 10.0
## The tile's side (px) and its bevel.
const TILE := 128
const BEVEL := 3
## An SVG renders with its longest side here.
const SVG_SIDE := 256.0
## An SVG that declares no size is first probed at 1 / this scale.
const SVG_PROBE := 64.0
## An SVG declaring a longest side above this (px) is refused.
const SVG_MAX_DECLARED := 100000.0
## CSS px per unit, for an SVG root's `width` / `height`.
const SVG_UNITS := {"": 1.0, "px": 1.0, "pt": 4.0 / 3.0, "pc": 16.0, "mm": 96.0 / 25.4, "cm": 96.0 / 2.54, "in": 96.0}

## Tests: `requester.call(url, done)` instead of an [HTTPRequest];
## `done.call(ok: bool, headers: PackedStringArray, body: PackedByteArray)`.
var requester: Callable

var _textures := {}
var _failed := {}
var _in_flight := {}
var _queue: Array[String] = []
var _free: Array[HTTPRequest] = []


func _ready() -> void:
	for i in POOL:
		var r := HTTPRequest.new()
		r.timeout = TIMEOUT
		r.body_size_limit = MAX_BYTES
		r.use_threads = true
		add_child(r)
		_free.append(r)


## The picture for `url`, or null (not fetched yet, or failed).
func texture(url: String) -> Texture2D:
	return _textures.get(url)


func has_failed(url: String) -> bool:
	return _failed.has(url)


## Fetch `url` unless it is cached, in flight, queued or has failed;
## [signal loaded] says when it lands.
func fetch(url: String) -> void:
	if url == "" or _textures.has(url) or _failed.has(url) or _in_flight.has(url) or _queue.has(url):
		return
	_queue.append(url)
	_pump()


## Requests out right now.
func in_flight() -> int:
	return _in_flight.size()


func _pump() -> void:
	while not _queue.is_empty() and _in_flight.size() < POOL:
		var url: String = _queue.pop_front()
		_in_flight[url] = true
		var done := func(ok: bool, headers: PackedStringArray, body: PackedByteArray) -> void: _landed(url, ok, headers, body)
		if requester.is_valid():
			requester.call(url, done)
			continue
		if _free.is_empty():
			_in_flight.erase(url)
			_queue.push_front(url)
			return
		var r: HTTPRequest = _free.pop_back()
		var handler := func(result: int, code: int, headers: PackedStringArray, body: PackedByteArray) -> void:
			_free.append(r)
			done.call(result == HTTPRequest.RESULT_SUCCESS and code == 200, headers, body)
		r.request_completed.connect(handler, CONNECT_ONE_SHOT)
		if r.request(url, PackedStringArray(["Accept: image/png, image/jpeg, image/webp, image/svg+xml"])) != OK:
			r.request_completed.disconnect(handler)
			_free.append(r)
			done.call(false, PackedStringArray(), PackedByteArray())


func _landed(url: String, ok: bool, headers: PackedStringArray, body: PackedByteArray) -> void:
	_in_flight.erase(url)
	var img: Image = decode(body, _content_type(headers)) if ok and body.size() <= MAX_BYTES else null
	if img == null:
		_failed[url] = true
	else:
		var tex := ImageTexture.create_from_image(tile_of(img))
		_textures[url] = tex
		loaded.emit(url, tex)
	_pump()


static func _content_type(headers: PackedStringArray) -> String:
	for h: String in headers:
		if h.to_lower().begins_with("content-type:"):
			return h.substr(13).strip_edges().to_lower()
	return ""


## What the bytes are, by their magic: "png" | "jpeg" | "webp" | "svg" |
## "gif" | "avif" | "" (unknown). An SVG is text starting with `<` (after a
## BOM or whitespace), or anything served as `image/svg+xml`.
static func sniff(b: PackedByteArray, content_type := "") -> String:
	if b.size() >= 8 and b[0] == 0x89 and b[1] == 0x50 and b[2] == 0x4E and b[3] == 0x47:
		return "png"
	if b.size() >= 3 and b[0] == 0xFF and b[1] == 0xD8 and b[2] == 0xFF:
		return "jpeg"
	if b.size() >= 12 and b.slice(0, 4).get_string_from_ascii() == "RIFF" and b.slice(8, 12).get_string_from_ascii() == "WEBP":
		return "webp"
	if b.size() >= 6 and b.slice(0, 6).get_string_from_ascii() == "GIF89a" or b.size() >= 6 and b.slice(0, 6).get_string_from_ascii() == "GIF87a":
		return "gif"
	if b.size() >= 12 and b.slice(4, 8).get_string_from_ascii() == "ftyp" and b.slice(8, 12).get_string_from_ascii().begins_with("avi"):
		return "avif"
	if content_type.begins_with("image/svg"):
		return "svg"
	var i := 0
	if b.size() >= 3 and b[0] == 0xEF and b[1] == 0xBB and b[2] == 0xBF:
		i = 3
	while i < b.size() and b[i] in [0x20, 0x09, 0x0A, 0x0D]:
		i += 1
	if i < b.size() and b[i] == 0x3C:  # "<"
		return "svg"
	return ""


## Decode a picture (null when it isn't one Godot can read).
static func decode(b: PackedByteArray, content_type := "") -> Image:
	var kind := sniff(b, content_type)
	if kind == "" or kind == "gif" or kind == "avif":
		return null
	var img := Image.new()
	var err := ERR_FILE_UNRECOGNIZED
	match kind:
		"png":
			err = img.load_png_from_buffer(b)
		"jpeg":
			err = img.load_jpg_from_buffer(b)
		"webp":
			err = img.load_webp_from_buffer(b)
		"svg":
			# Render once, near SVG_SIDE: the scale comes from the size the
			# root declares (or a tiny probe render), never a full-size
			# render first — a 2 MB file may declare 12000 px.
			var side := svg_side(b)
			if side <= 0.0:
				var probe := Image.new()
				if probe.load_svg_from_buffer(b, 1.0 / SVG_PROBE) == OK and not probe.is_empty():
					side = maxf(probe.get_width(), probe.get_height()) * SVG_PROBE
				elif probe.load_svg_from_buffer(b, 1.0) == OK and not probe.is_empty():
					side = maxf(probe.get_width(), probe.get_height())  # under SVG_PROBE px: cheap
			if side <= 0.0 or side > SVG_MAX_DECLARED:
				return null
			err = img.load_svg_from_buffer(b, SVG_SIDE / side)
	if err != OK or img.is_empty():
		return null
	return img


## The longest side (px) the SVG's root `<svg>` declares — its `width` /
## `height` (absolute units only), else its `viewBox` — or 0 when it
## declares none. Only the first 8 KB are read.
static func svg_side(b: PackedByteArray) -> float:
	var text := b.slice(0, mini(b.size(), 8192)).get_string_from_utf8()
	var root := RegEx.create_from_string("<svg\\b[^>]*>").search(text)
	if root == null:
		return 0.0
	var tag := root.get_string()
	var side := 0.0
	for attr: String in ["width", "height"]:
		var m := RegEx.create_from_string("[\\s]%s\\s*=\\s*[\"']\\s*([0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\\s*([a-z]*)\\s*[\"']" % attr).search(tag)
		if m != null and SVG_UNITS.has(m.get_string(2)):
			side = maxf(side, float(m.get_string(1)) * float(SVG_UNITS[m.get_string(2)]))
	if side > 0.0:
		return side
	var vb := RegEx.create_from_string("[\\s]viewBox\\s*=\\s*[\"']([^\"']*)[\"']").search(tag)
	if vb != null:
		var nums := vb.get_string(1).replace(",", " ").split(" ", false)
		if nums.size() == 4:
			side = maxf(absf(float(nums[2])), absf(float(nums[3])))
	return side


## The ghost's head: the picture fitted (aspect kept) into a white square
## with a Win98 bevel (white top / left, grey and black bottom / right),
## [constant TILE] px, mipmapped.
static func tile_of(src: Image) -> Image:
	var img := src.duplicate() as Image
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	var inner := TILE - 2 * BEVEL - 4
	var scale := float(inner) / float(maxi(img.get_width(), img.get_height()))
	img.resize(maxi(1, int(round(img.get_width() * scale))), maxi(1, int(round(img.get_height() * scale))), Image.INTERPOLATE_BILINEAR)
	var out := Image.create(TILE, TILE, false, Image.FORMAT_RGBA8)
	out.fill(Color("#c0c0c0"))
	for i in BEVEL:
		var lo := i
		var hi := TILE - 1 - i
		var light := Color.WHITE if i < BEVEL - 1 else Color("#dfdfdf")
		var dark := Color("#000000") if i == 0 else Color("#808080")
		out.fill_rect(Rect2i(lo, lo, hi - lo + 1, 1), light)
		out.fill_rect(Rect2i(lo, lo, 1, hi - lo + 1), light)
		out.fill_rect(Rect2i(lo, hi, hi - lo + 1, 1), dark)
		out.fill_rect(Rect2i(hi, lo, 1, hi - lo + 1), dark)
	out.fill_rect(Rect2i(BEVEL + 2, BEVEL + 2, inner, inner), Color.WHITE)
	var at := Vector2i(BEVEL + 2 + (inner - img.get_width()) / 2, BEVEL + 2 + (inner - img.get_height()) / 2)
	out.blend_rect(img, Rect2i(0, 0, img.get_width(), img.get_height()), at)
	out.generate_mipmaps()
	return out
