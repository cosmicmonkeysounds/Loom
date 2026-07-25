## Value semantics for the Loom bank runtime.
##
## Loom values map straight onto Godot Variants: null, bool, float, String,
## Array. There is no integer type in Loom — every number is an f64 — so
## numbers are always stored as `float` and rendered through
## [method format_number] rather than `str()`.
##
## Normative spec: `docs/loom-banks.md` §2.1-2.2. Everything
## here exists because GDScript's defaults differ from the spec: integer
## division, integer `%`, and float printing all disagree.
class_name LoomValue
extends RefCounted


## Render a number exactly as the reference implementation does.
##
## The normative definition is ECMA-262 `Number::toString` (JavaScript's
## `String(n)`), chosen because the live engine's `display()` already is
## that. Godot's own `str(float)` truncates to six significant digits, so
## it cannot be used: `str(1.0/3.0)` gives "0.333333" where the spec
## requires "0.3333333333333333".
## Godot gives us nothing usable here, so the algorithm is spelled out.
##
## `str(float)` truncates to 14 significant digits; `%g` and `%e` are not
## supported format characters at all; and `String.num` only ever produces
## plain decimal notation, never an exponent. So this recovers the shortest
## round-tripping *digits* from `String.num`, then applies ECMA-262
## `Number::toString` step 5 to choose the output form.
static func format_number(value: float) -> String:
	if is_nan(value):
		return "NaN"
	if is_inf(value):
		return "-Infinity" if value < 0.0 else "Infinity"
	if value == 0.0:
		return "0"  # also normalises -0.0, matching String(-0)

	var negative := value < 0.0
	var magnitude := absf(value)
	var sign := "-" if negative else ""

	# An integral value inside 2^53 has exact int64 digits. This path is
	# not just an optimisation: Godot's `String.num` loses precision near
	# 2^53, rendering 9007199254740991 as ...990.
	if magnitude == floor(magnitude) and magnitude < 9.007199254740992e15:
		var text := str(int(magnitude))
		return sign + _compose_form(_strip_trailing_zeros(text), text.length())

	var plain := _shortest_plain(magnitude)
	if plain.to_float() != magnitude:
		# Godot cannot render this magnitude in plain decimal at all (any
		# value below ~1e-18 collapses to zeros). Normalise through a
		# power of ten instead.
		return _format_via_exponent(magnitude, sign)

	# Decompose into ECMA's (s, k, n): value == s * 10^(n - k), where the
	# digit string `s` has k digits and no leading or trailing zero.
	var integer_part := plain
	var fraction := ""
	var dot := plain.find(".")
	if dot >= 0:
		integer_part = plain.substr(0, dot)
		fraction = plain.substr(dot + 1)

	var all_digits := integer_part + fraction
	var leading := 0
	while leading < all_digits.length() - 1 and all_digits[leading] == "0":
		leading += 1
	var s := _strip_trailing_zeros(all_digits.substr(leading))
	if s == "0":
		return "0"
	return sign + _compose_form(s, integer_part.length() - leading)


## ECMA-262 `Number::toString` step 5: pick the output form from the digit
## string `s` and the decimal point position `n`.
static func _compose_form(s: String, n: int) -> String:
	var k := s.length()
	if k <= n and n <= 21:
		return s + "0".repeat(n - k)
	if 0 < n and n <= 21:
		return s.substr(0, n) + "." + s.substr(n)
	if -6 < n and n <= 0:
		return "0." + "0".repeat(-n) + s
	# Exponential form. JavaScript writes the minimum number of exponent
	# digits and always an explicit sign — `1e+21`, `1e-7`.
	var exponent := n - 1
	var mantissa := s if k == 1 else s.substr(0, 1) + "." + s.substr(1)
	return mantissa + "e" + ("+" if exponent >= 0 else "-") + str(absi(exponent))


## Render a magnitude Godot cannot print in plain decimal, by scaling it
## into [1, 10) and reassembling. The round-trip check is against the
## *assembled* string, so a scaling error cannot slip through.
static func _format_via_exponent(magnitude: float, sign: String) -> String:
	var exponent := int(floor(log(magnitude) / log(10.0)))
	for significant in range(1, 19):
		var scale := pow(10.0, exponent)
		var mantissa := magnitude / scale
		if mantissa >= 10.0:
			# log10 landed a decade off — correct and rescale.
			exponent += 1
			mantissa = magnitude / pow(10.0, exponent)
		elif mantissa < 1.0:
			exponent -= 1
			mantissa = magnitude / pow(10.0, exponent)
		var text := String.num(mantissa, significant - 1)
		if text.to_float() >= 10.0:
			# Rounding carried into a new decade, e.g. 9.99 -> 10.0.
			exponent += 1
			text = String.num(magnitude / pow(10.0, exponent), significant - 1)
		var digits := _strip_trailing_zeros(text.replace(".", ""))
		var candidate := _compose_form(digits, exponent + 1)
		if candidate.to_float() == magnitude:
			return sign + candidate
	return sign + _compose_form("1", exponent + 1)


static func _strip_trailing_zeros(text: String) -> String:
	var out := text
	while out.length() > 1 and out.ends_with("0"):
		out = out.substr(0, out.length() - 1)
	return out


## The shortest plain-decimal string that parses back to exactly `value`.
## This is what a Ryu/Grisu implementation produces directly; walking the
## decimal count is the portable equivalent.
static func _shortest_plain(value: float) -> String:
	for decimals in range(0, 18):
		var candidate := String.num(value, decimals)
		if candidate.to_float() == value:
			return _trim_trailing_point(candidate)
	return _trim_trailing_point(String.num(value, 17))


static func _trim_trailing_point(text: String) -> String:
	var out := text
	if out.ends_with(".0"):
		out = out.substr(0, out.length() - 2)
	if out.ends_with("."):
		out = out.substr(0, out.length() - 1)
	return out


## Render any value for display or interpolation.
static func display(value: Variant) -> String:
	if value == null:
		return "null"
	match typeof(value):
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return format_number(float(value))
		TYPE_FLOAT:
			return format_number(value)
		TYPE_STRING, TYPE_STRING_NAME:
			return str(value)
		TYPE_ARRAY:
			var parts: Array[String] = []
			for item in value:
				parts.append(display(item))
			return "[" + ", ".join(parts) + "]"
	return str(value)


## Truthiness. Note an empty string and an empty list are falsey, and so is
## NaN — Godot's own `if value:` would disagree on several of these.
static func truthy(value: Variant) -> bool:
	if value == null:
		return false
	match typeof(value):
		TYPE_BOOL:
			return value
		TYPE_INT:
			return value != 0
		TYPE_FLOAT:
			return value != 0.0 and not is_nan(value)
		TYPE_STRING, TYPE_STRING_NAME:
			return (value as String).length() > 0
		TYPE_ARRAY:
			return (value as Array).size() > 0
	return true


## Numeric coercion: bools count, everything non-numeric is null.
static func as_number(value: Variant) -> Variant:
	match typeof(value):
		TYPE_FLOAT:
			return value
		TYPE_INT:
			return float(value)
		TYPE_BOOL:
			return 1.0 if value else 0.0
	return null


static func _num(value: Variant) -> float:
	var n: Variant = as_number(value)
	return 0.0 if n == null else n


## Cross-type equality, matching the reference `valuesEqual`.
static func values_equal(a: Variant, b: Variant) -> bool:
	if a == null and b == null:
		return true
	if a == null or b == null:
		return false
	var a_str := typeof(a) == TYPE_STRING or typeof(a) == TYPE_STRING_NAME
	var b_str := typeof(b) == TYPE_STRING or typeof(b) == TYPE_STRING_NAME
	if a_str or b_str:
		return a_str and b_str and str(a) == str(b)
	if typeof(a) == TYPE_BOOL and typeof(b) == TYPE_BOOL:
		return a == b
	var x: Variant = as_number(a)
	var y: Variant = as_number(b)
	return x != null and y != null and x == y


## Binary operators. Deliberately avoids GDScript's `/` and `%` on ints:
## Loom is all-f64, so division by zero must yield inf/nan and `%` must be
## the truncated remainder (`-7 % 3 == -1`).
static func apply_binary(op: int, left: Variant, right: Variant) -> Variant:
	match op:
		LoomOps.E_ADD:
			if typeof(left) == TYPE_STRING or typeof(left) == TYPE_STRING_NAME:
				return str(left) + display(right)
			if typeof(right) == TYPE_STRING or typeof(right) == TYPE_STRING_NAME:
				return display(left) + str(right)
			return _num(left) + _num(right)
		LoomOps.E_SUB:
			return _num(left) - _num(right)
		LoomOps.E_MUL:
			return _num(left) * _num(right)
		LoomOps.E_DIV:
			var divisor := _num(right)
			var dividend := _num(left)
			if divisor == 0.0:
				# IEEE semantics, which GDScript's float `/` by 0 does not
				# give (it errors / returns 0 depending on context).
				if dividend == 0.0:
					return NAN
				return INF if dividend > 0.0 else -INF
			return dividend / divisor
		LoomOps.E_MOD:
			var m := _num(right)
			if m == 0.0:
				return NAN
			return fmod(_num(left), m)
		LoomOps.E_EQ:
			return values_equal(left, right)
		LoomOps.E_NE:
			return not values_equal(left, right)
		LoomOps.E_LT:
			return _num(left) < _num(right)
		LoomOps.E_LE:
			return _num(left) <= _num(right)
		LoomOps.E_GT:
			return _num(left) > _num(right)
		LoomOps.E_GE:
			return _num(left) >= _num(right)
	return null


## Decode a bank's tagged value literal into a native Variant.
static func from_bank(entry: Variant) -> Variant:
	if typeof(entry) != TYPE_DICTIONARY:
		return null
	var tag: String = entry.get("t", "null")
	match tag:
		"bool":
			return bool(entry.get("v", false))
		"num":
			return float(entry.get("v", 0.0))
		"str":
			return str(entry.get("v", ""))
		"list":
			var out: Array = []
			for item in entry.get("v", []):
				out.append(from_bank(item))
			return out
	return null


## Encode a native Variant as a bank/save tagged literal.
static func to_bank(value: Variant) -> Dictionary:
	if value == null:
		return {"t": "null"}
	match typeof(value):
		TYPE_BOOL:
			return {"t": "bool", "v": value}
		TYPE_INT:
			return {"t": "num", "v": float(value)}
		TYPE_FLOAT:
			return {"t": "num", "v": value}
		TYPE_STRING, TYPE_STRING_NAME:
			return {"t": "str", "v": str(value)}
		TYPE_ARRAY:
			var out: Array = []
			for item in value:
				out.append(to_bank(item))
			return {"t": "list", "v": out}
	return {"t": "null"}
