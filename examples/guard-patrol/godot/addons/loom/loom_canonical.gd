## Canonical JSON — the trace serialiser.
##
## Godot's `JSON.stringify` cannot be used for conformance output: it
## preserves insertion order rather than sorting keys, and it formats
## floats differently from the spec. Both would make every trace diff fail
## for reasons unrelated to story semantics.
class_name LoomCanonical
extends RefCounted


static func stringify(value: Variant) -> String:
	if value == null:
		return "null"
	match typeof(value):
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return LoomValue.format_number(float(value))
		TYPE_FLOAT:
			# JSON has no NaN or Infinity; they serialise as their spec'd
			# *string* spellings rather than becoming null.
			if is_nan(value) or is_inf(value):
				return "\"%s\"" % LoomValue.format_number(value)
			return LoomValue.format_number(value)
		TYPE_STRING, TYPE_STRING_NAME:
			return _quote(str(value))
		TYPE_ARRAY:
			var items: Array[String] = []
			for item in value:
				items.append(stringify(item))
			return "[" + ",".join(items) + "]"
		TYPE_DICTIONARY:
			var keys: Array = (value as Dictionary).keys()
			keys.sort()
			var pairs: Array[String] = []
			for key in keys:
				var member: Variant = value[key]
				if member == null and not _keeps_null(key):
					continue
				pairs.append("%s:%s" % [_quote(str(key)), stringify(member)])
			return "{" + ",".join(pairs) + "}"
	return "null"


## `pendingMenu` is meaningfully null in a save blob; optional step fields
## are omitted when absent. The reference does the same by only ever
## setting the fields it means.
static func _keeps_null(key: Variant) -> bool:
	return str(key) == "pendingMenu"


static func _quote(text: String) -> String:
	var out := "\""
	for i in text.length():
		var ch := text[i]
		var code := text.unicode_at(i)
		match ch:
			"\"":
				out += "\\\""
			"\\":
				out += "\\\\"
			"\n":
				out += "\\n"
			"\r":
				out += "\\r"
			"\t":
				out += "\\t"
			_:
				if code < 0x20:
					out += "\\u%04x" % code
				else:
					out += ch
	return out + "\""
