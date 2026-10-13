## A reconnecting `text/event-stream` reader over [HTTPClient] (Godot has
## no EventSource). Non-blocking: polled from `_process`, frames decoded by
## [SseParser]. Reconnects with exponential backoff (1 s → 15 s), and when
## nothing — not even the server's 25 s `:ping` — arrives for 60 s.
class_name SseClient
extends Node

signal frame(event: String, data: Variant)
signal opened
signal closed

const BACKOFF_MIN := 1.0
const BACKOFF_MAX := 15.0
const CONNECT_TIMEOUT := 10.0
const IDLE_TIMEOUT := 60.0

var _url: Dictionary = {}
var _path := ""
var _headers := PackedStringArray()
var _client: HTTPClient = null
var _parser := SseParser.new()
var _active := false
var _requested := false
var _streaming := false
var _backoff := BACKOFF_MIN
var _retry_in := 0.0
var _quiet := 0.0


## Open (or re-open) the stream at `base` (`http://host:port`) + `path`.
func open(base: String, path: String, headers: PackedStringArray = PackedStringArray()) -> void:
	close()
	_url = StationConfig.parse_url(base)
	_path = str(_url.get("path", "")) + path
	_headers = headers
	_headers.append("Accept: text/event-stream")
	_active = not _url.is_empty()
	_backoff = BACKOFF_MIN
	_retry_in = 0.0


func close() -> void:
	_active = false
	_drop()


func is_open() -> bool:
	return _streaming


func _drop() -> void:
	if _client != null:
		_client.close()
	_client = null
	_requested = false
	_parser.reset()
	if _streaming:
		_streaming = false
		closed.emit()


func _fail() -> void:
	_drop()
	_retry_in = _backoff
	_backoff = minf(_backoff * 2.0, BACKOFF_MAX)


func _process(delta: float) -> void:
	if not _active:
		return
	if _client == null:
		_retry_in -= delta
		if _retry_in > 0.0:
			return
		_client = HTTPClient.new()
		var tls: TLSOptions = TLSOptions.client() if _url["tls"] else null
		if _client.connect_to_host(str(_url["host"]), int(_url["port"]), tls) != OK:
			_fail()
			return
		_quiet = 0.0
	_quiet += delta
	_client.poll()
	match _client.get_status():
		HTTPClient.STATUS_RESOLVING, HTTPClient.STATUS_CONNECTING, HTTPClient.STATUS_REQUESTING:
			if _quiet > CONNECT_TIMEOUT:
				_fail()
		HTTPClient.STATUS_CONNECTED:
			if _requested:
				_fail()  # the response ended: the server closed the stream
			elif _client.request(HTTPClient.METHOD_GET, _path, _headers) == OK:
				_requested = true
			else:
				_fail()
		HTTPClient.STATUS_BODY:
			if _client.get_response_code() != 200:
				_fail()
				return
			if not _streaming:
				_streaming = true
				_backoff = BACKOFF_MIN
				opened.emit()
			var chunk := _client.read_response_body_chunk()
			if chunk.size() > 0:
				_quiet = 0.0
				for f: Dictionary in _parser.feed(chunk):
					frame.emit(str(f["event"]), f["data"])
			elif _quiet > IDLE_TIMEOUT:
				_fail()
		_:
			_fail()
