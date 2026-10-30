## A small pool of [HTTPRequest]s with a FIFO for overflow: `send` a JSON
## call, get `done.call(status, data)` back (`status` 0 = no answer). The
## pose pump keeps its own call to one at a time, so a burst of control
## calls can never starve it for long.
class_name HttpTransport
extends Node

const POOL := 4
const TIMEOUT := 8.0

var base := ""

var _free: Array[HTTPRequest] = []
var _queue: Array = []


func _ready() -> void:
	for i in POOL:
		var r := HTTPRequest.new()
		r.timeout = TIMEOUT
		# Off the main thread: each call's connect + TLS handshake took a
		# frame on the Quest (the 1 s station poll, the 10 Hz poses), and a
		# missed frame snaps the view while walking or turning.
		r.use_threads = true
		add_child(r)
		_free.append(r)


## `method` "GET" / "POST"; `path` absolute from the server root; `body`
## a JSON-able value (ignored for GET) or `null`; `token` sent as
## `x-loom-token` when not empty.
func send(method: String, path: String, body: Variant, token: String, done: Callable) -> void:
	_queue.append([method, path, body, token, done])
	_pump()


func _pump() -> void:
	while not _queue.is_empty() and not _free.is_empty():
		var call: Array = _queue.pop_front()
		var r: HTTPRequest = _free.pop_back()
		var headers := PackedStringArray(["Accept: application/json"])
		if str(call[3]) != "":
			headers.append("x-loom-token: %s" % call[3])
		var method := HTTPClient.METHOD_GET
		var payload := ""
		if call[0] == "POST":
			method = HTTPClient.METHOD_POST
			headers.append("Content-Type: application/json")
			payload = JSON.stringify(call[2] if call[2] != null else {})
		var done: Callable = call[4]
		var handler := _on_completed.bind(r, done)
		r.request_completed.connect(handler, CONNECT_ONE_SHOT)
		var err := r.request(base + str(call[1]), headers, method, payload)
		if err != OK:
			r.request_completed.disconnect(handler)
			_free.append(r)
			done.call(0, null)


func _on_completed(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray, r: HTTPRequest, done: Callable) -> void:
	_free.append(r)
	var status := code if result == HTTPRequest.RESULT_SUCCESS else 0
	var data: Variant = null
	if body.size() > 0:
		data = JSON.parse_string(body.get_string_from_utf8())
	done.call(status, data)
	_pump()


## Cancel everything queued (in-flight calls still answer).
func clear_queue() -> void:
	_queue.clear()
