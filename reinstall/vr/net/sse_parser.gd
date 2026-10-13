## A `text/event-stream` decoder: feed it raw bytes as they arrive, take
## complete frames out. Pure (no I/O) — [SseClient] owns the socket.
##
## Frames are `{event, data}`; `data` is the joined `data:` lines parsed as
## JSON (the raw string when it isn't JSON). Comment lines (`:ok`, `:ping`)
## and `id:` / `retry:` are dropped.
class_name SseParser
extends RefCounted

var _buffer := ""
var _event := ""
var _data: PackedStringArray = []


func reset() -> void:
	_buffer = ""
	_event = ""
	_data.clear()


## Decode a chunk; returns the frames it completed (possibly none).
func feed(chunk: PackedByteArray) -> Array:
	return feed_text(chunk.get_string_from_utf8())


func feed_text(text: String) -> Array:
	_buffer += text.replace("\r\n", "\n").replace("\r", "\n")
	var frames: Array = []
	while true:
		var nl := _buffer.find("\n")
		if nl < 0:
			break
		var line := _buffer.substr(0, nl)
		_buffer = _buffer.substr(nl + 1)
		if line == "":
			if not _data.is_empty():
				var raw := "\n".join(_data)
				var json := JSON.new()
				var data: Variant = json.data if json.parse(raw) == OK else raw
				frames.append({"event": _event if _event != "" else "message", "data": data})
			_event = ""
			_data.clear()
			continue
		if line.begins_with(":"):
			continue
		var colon := line.find(":")
		var field := line if colon < 0 else line.substr(0, colon)
		var value := "" if colon < 0 else line.substr(colon + 1)
		if value.begins_with(" "):
			value = value.substr(1)
		if field == "event":
			_event = value
		elif field == "data":
			_data.append(value)
	return frames
