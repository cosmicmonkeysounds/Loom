## An [HttpTransport] that records every call and answers only when the
## test says so — `ServerLink` driven without a network.
extends HttpTransport

## `{id, method, path, body, token, done}` per call, oldest first, until answered.
var calls: Array = []
var _next_id := 0
## Every path ever sent, in order.
var log: Array = []


func _ready() -> void:
	pass  # no HTTPRequest pool


func send(method: String, path: String, body: Variant, token: String, done: Callable) -> void:
	_next_id += 1
	calls.append({"id": _next_id, "method": method, "path": path, "body": body, "token": token, "done": done})
	log.append("%s %s" % [method, path])


func clear_queue() -> void:
	pass  # nothing is queued here: every call is "in flight" until answered


## Answer the oldest open call whose path contains `part`; false when none.
func answer(part: String, status: int, data: Variant = null) -> bool:
	for i in calls.size():
		if str(calls[i]["path"]).contains(part):
			var c: Dictionary = calls[i]
			calls.remove_at(i)
			(c["done"] as Callable).call(status, data)
			return true
	return false


## Answer the open call with this `id`; false when it isn't open.
func answer_id(id: int, status: int, data: Variant = null) -> bool:
	for i in calls.size():
		if int(calls[i]["id"]) == id:
			var c: Dictionary = calls[i]
			calls.remove_at(i)
			(c["done"] as Callable).call(status, data)
			return true
	return false


func count(part: String) -> int:
	var n := 0
	for p: String in log:
		if p.contains(part):
			n += 1
	return n
