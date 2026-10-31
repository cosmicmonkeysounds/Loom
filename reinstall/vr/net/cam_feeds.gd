## The real rooms through the house's terminals (wave 14): every wall
## terminal uploads its camera to the server (`POST …/api/mod/spatial/cam`)
## and the headset shows the newest frame on that terminal's screen, so a
## player walking the virtual house sees the people in the real room.
##
## While playing, [method tick] lists the live feeds every
## [constant LIST_INTERVAL] s (`GET /e/<event>/api/spatial/cams`, the token
## the map is fetched with) and, for the terminals in the player's own room
## (wave 26 C7 / R5: the presence room, [method HouseLocate.presence_room],
## with its doorway hysteresis; never the tent's reinstall station —
## [method spots_to_poll], the nearest [constant MAX_FEEDS]), fetches each
## one's frame about
## [constant FRAME_RATE] times a second (`GET …/api/spatial/cam?spot=<id>`,
## a JPEG), one request per spot in flight. Requests run on this node's own
## [HTTPRequest]s (one per feed plus one for the list, so nothing queues and
## nothing touches the JSON transport or the frame loop). A frame lands in
## the spot's [ImageTexture], updated in place ([method apply]), and
## [signal feed_shown] says so the first time; a 404, a frame that won't
## decode, a spot that leaves the list / the room or no fresh
## frame for [constant STALE] s ends it ([signal feed_lost]) — the terminal
## keeps its usual screen. A failed call backs off ([method backoff]) up to
## [constant BACKOFF_MAX] s, never in a loop; [method stop] (the session
## ended) drops everything and ignores any answer still on its way.
class_name CamFeeds
extends Node

## A spot's feed is up (the first good frame); `texture` is updated in place after.
signal feed_shown(spot: String, texture: Texture2D)
## A spot's feed went away: back to the terminal's own screen.
signal feed_lost(spot: String)

const LIST_INTERVAL := 2.0
const FRAME_RATE := 3.0
const MAX_FEEDS := 4
## A shown feed with no good frame for this long (s) is dropped: a picture
## frozen longer is no window on the room (the server stops serving a
## frame after 15 s).
const STALE := 5.0
const BACKOFF_MAX := 30.0
## A spot's frames back off to at most this (s), so a terminal that comes
## back is on the panel again within seconds.
const FRAME_BACKOFF_MAX := 5.0
## The server refuses a frame over 96 KB; leave room for the list.
const MAX_BYTES := 256 * 1024
const TIMEOUT := 5.0

## Tests: `requester.call(url, token, done)` instead of an [HTTPRequest];
## `done.call(status: int, headers: PackedStringArray, body: PackedByteArray)`
## (`status` 0 = no answer).
var requester: Callable

var _free: Array[HTTPRequest] = []
## Bumped by [method stop]: an answer from an earlier epoch is dropped.
var _epoch := 0
var _clock := 0.0
var _active := false
## spot → `{at, w, h}` off the last list.
var _listed := {}
var _list_in := 0.0
var _list_fails := 0
var _list_pending := false
## spot → `{in, fails, pending, ok_at}` for the spots being polled.
var _spots := {}
## spot → [ImageTexture], kept across feeds so a returning feed reuses it.
var _textures := {}
## spot → true while its feed is shown.
var _shown := {}
## Held for good, so the feeds' shader outlives the last feed of a room.
var _feed_shader := HouseBuilder.feed_material()
## The player's presence room (null = none: the void, no session).
var _presence: Variant = null


func _ready() -> void:
	for i in MAX_FEEDS + 1:
		var r := HTTPRequest.new()
		r.timeout = TIMEOUT
		r.body_size_limit = MAX_BYTES
		r.use_threads = true
		add_child(r)
		_free.append(r)


## One frame of play: `house` the map in play, `feet` the player (house
## coordinates), `base` the event's spatial root (`http://…/e/<id>/api/spatial`,
## "" = no feeds: offline), `token` the session's (else the moderator's).
func tick(delta: float, house: Dictionary, feet: Array, base: String, token: String) -> void:
	if base == "":
		stop()
		return
	_active = true
	_clock += delta
	_list_in -= delta
	if _list_in <= 0.0 and not _list_pending:
		_fetch_list(base, token)
	_presence = HouseLocate.presence_room(house, feet, _presence) if feet.size() >= 3 else null
	var wanted := spots_to_poll(house, _listed.values(), feet, _presence)
	for spot: String in _spots.keys():
		if not wanted.has(spot):
			_drop(spot)
	for spot: String in wanted:
		if not _spots.has(spot):
			_spots[spot] = {"in": 0.0, "fails": 0, "pending": false, "ok_at": _clock}
		var s: Dictionary = _spots[spot]
		if _shown.has(spot) and _clock - float(s["ok_at"]) > STALE:
			_lose(spot)
		s["in"] = float(s["in"]) - delta
		if float(s["in"]) <= 0.0 and not bool(s["pending"]):
			_fetch_frame(spot, base, token)


## The session ended: every feed off, nothing more asked, late answers ignored.
func stop() -> void:
	if not _active:
		return
	_active = false
	_epoch += 1
	_presence = null
	for spot: String in _shown.keys():
		_lose(spot)
	_spots.clear()
	_listed.clear()
	_list_pending = false
	_list_in = 0.0
	_list_fails = 0


func is_shown(spot: String) -> bool:
	return _shown.has(spot)


## The spots being polled right now.
func polling() -> Array:
	return _spots.keys()


func texture(spot: String) -> Texture2D:
	return _textures.get(spot)


# --- pure helpers ------------------------------------------------------------


## The listed terminals (`cams`: list entries or spot ids) in room `room`
## (the player's presence room; null = none), never a `view: "reinstall"`
## station ([method HouseLocate.linked_spots]), nearest to `feet` (plan)
## first, at most `most`. The server lists and serves only those anyway (C7).
static func spots_to_poll(house: Dictionary, cams: Array, feet: Array, room: Variant, most := MAX_FEEDS) -> Array:
	if feet.size() < 3 or room == null:
		return []
	var listed := {}
	for c: Variant in cams:
		listed[str(c.get("spot", "")) if c is Dictionary else str(c)] = true
	var linked := HouseLocate.linked_spots(house, [room])
	var near: Array = []
	for t: Dictionary in house.get("terminals", []):
		var id := str(t.get("id", ""))
		var pos: Array = t.get("pos", [])
		if not listed.has(id) or not linked.has(id) or pos.size() < 3:
			continue
		near.append([Vector2(float(pos[0]) - float(feet[0]), float(pos[2]) - float(feet[2])).length(), id])
	near.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and str(a[1]) < str(b[1])))
	var out: Array = []
	for n: Array in near.slice(0, most):
		out.append(n[1])
	return out


## The player's presence room as the feeds see it (null = none).
func presence() -> Variant:
	return _presence


## The wait (s) before the next call after `fails` failures in a row:
## `interval` with none, else `floor_s` doubling per failure, at most
## [constant BACKOFF_MAX].
static func backoff(fails: int, interval: float, floor_s := 1.0, cap := BACKOFF_MAX) -> float:
	if fails <= 0:
		return interval
	return minf(cap, floor_s * pow(2.0, fails - 1))


## Put `img` on `tex` in place (same size and format → `update`, else
## `set_image`; a new texture only when there is none yet).
static func apply(tex: ImageTexture, img: Image) -> ImageTexture:
	if tex == null:
		return ImageTexture.create_from_image(img)
	if tex.get_width() == img.get_width() and tex.get_height() == img.get_height() and tex.get_format() == img.get_format():
		tex.update(img)
	else:
		tex.set_image(img)
	return tex


## A JPEG frame decoded, or null.
static func decode(body: PackedByteArray) -> Image:
	if AvatarCache.sniff(body) != "jpeg":
		return null
	var img := Image.new()
	if img.load_jpg_from_buffer(body) != OK or img.is_empty():
		return null
	return img


## The `cams` list off a reply body (`{cams: [{spot, at, w, h}]}`), spot → entry.
static func parse_list(body: PackedByteArray) -> Dictionary:
	var out := {}
	var json := JSON.new()  # not JSON.parse_string: a junk body logs nothing
	if body.size() == 0 or json.parse(body.get_string_from_utf8()) != OK:
		return out
	var data: Variant = json.data
	if not data is Dictionary or not (data as Dictionary).get("cams") is Array:
		return out
	for c: Variant in data["cams"]:
		if c is Dictionary and str(c.get("spot", "")) != "":
			out[str(c["spot"])] = c
	return out


# --- the wire ------------------------------------------------------------------


func _fetch_list(base: String, token: String) -> void:
	_list_pending = true
	var epoch := _epoch
	_request(base + "/cams", token, func(status: int, _h: PackedStringArray, body: PackedByteArray) -> void:
		if epoch != _epoch:
			return
		_list_pending = false
		if status == 200:
			_listed = parse_list(body)
			_list_fails = 0
		else:
			_list_fails += 1
		_list_in = backoff(_list_fails, LIST_INTERVAL, LIST_INTERVAL))


func _fetch_frame(spot: String, base: String, token: String) -> void:
	var s: Dictionary = _spots[spot]
	s["pending"] = true
	var epoch := _epoch
	_request(base + "/cam?spot=" + spot.uri_encode(), token, func(status: int, _h: PackedStringArray, body: PackedByteArray) -> void:
		if epoch != _epoch or not _spots.has(spot) or not is_same(_spots[spot], s):
			return
		s["pending"] = false
		var img := decode(body) if status == 200 else null
		if img != null:
			_textures[spot] = apply(_textures.get(spot), img)
			s["fails"] = 0
			s["ok_at"] = _clock
			s["in"] = 1.0 / FRAME_RATE
			if not _shown.has(spot):
				_shown[spot] = true
				feed_shown.emit(spot, _textures[spot])
			return
		# 404 (no fresh frame) or junk: the screen goes back to itself. No
		# answer / a 5xx (a hiccup on the house wifi) keeps the last frame
		# until it is [constant STALE]. Either way the spot is asked again
		# later and later.
		if _shown.has(spot) and status != 0 and status < 500:
			_lose(spot)
		s["fails"] = int(s["fails"]) + 1
		s["in"] = backoff(int(s["fails"]), 1.0 / FRAME_RATE, 1.0, FRAME_BACKOFF_MAX))


## A request on a free [HTTPRequest] (or the test requester); with none
## free the answer is "no answer", so the caller backs off.
func _request(url: String, token: String, done: Callable) -> void:
	if requester.is_valid():
		requester.call(url, token, done)
		return
	if _free.is_empty():
		done.call(0, PackedStringArray(), PackedByteArray())
		return
	var r: HTTPRequest = _free.pop_back()
	var headers := PackedStringArray(["Accept: image/jpeg, application/json"])
	if token != "":
		headers.append("x-loom-token: %s" % token)
	var handler := func(result: int, code: int, h: PackedStringArray, body: PackedByteArray) -> void:
		_free.append(r)
		done.call(code if result == HTTPRequest.RESULT_SUCCESS else 0, h, body)
	r.request_completed.connect(handler, CONNECT_ONE_SHOT)
	if r.request(url, headers) != OK:
		r.request_completed.disconnect(handler)
		_free.append(r)
		done.call(0, PackedStringArray(), PackedByteArray())


func _drop(spot: String) -> void:
	if _shown.has(spot):
		_lose(spot)
	_spots.erase(spot)


func _lose(spot: String) -> void:
	_shown.erase(spot)
	feed_lost.emit(spot)
