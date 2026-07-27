## FNV-1a 64 over UTF-8 bytes.
##
## GDScript integers are signed 64-bit and wrap on overflow, which is
## exactly the arithmetic FNV needs — so the multiply/xor is done in `int`
## and only the *rendering* has to care about the sign.
class_name LoomHash
extends RefCounted

const OFFSET_BASIS := -3750763034362895579  # 0xcbf29ce484222325 as signed
const PRIME := 1099511628211  # 0x100000001b3


static func fnv1a64(name: String) -> int:
	var hash_value := OFFSET_BASIS
	for byte in name.to_utf8_buffer():
		hash_value = hash_value ^ byte
		# Signed 64-bit multiply wraps, which is the unsigned result's
		# bit pattern — the same value the reference computes mod 2^64.
		hash_value = hash_value * PRIME
	return hash_value


## The 16-char lowercase hex the bank format uses. Rendered from the
## *unsigned* bit pattern, so the two halves are formatted separately —
## "%x" on a negative int would emit a minus sign.
static func fnv1a64_hex(name: String) -> String:
	return to_hex(fnv1a64(name))


static func to_hex(value: int) -> String:
	var high := (value >> 32) & 0xffffffff
	var low := value & 0xffffffff
	return "%08x%08x" % [high, low]


## Parse 16-char hex into the signed-int bit pattern of the u64 — the
## inverse of [method to_hex]. Parsed in two halves because
## `hex_to_int` cannot represent values ≥ 2^63 directly.
static func hex64_to_int(hex: String) -> int:
	if hex.length() != 16:
		return 0
	var high := ("0x" + hex.substr(0, 8)).hex_to_int()
	var low := ("0x" + hex.substr(8, 8)).hex_to_int()
	return (high << 32) | low


# --- the spec'd <shuffle:> PRNG (xorshift64*, bank spec §10) --------------
#
# Mirrors `bank/src/prng.ts` bit for bit. GDScript ints are signed 64-bit
# and wrap, which is the same bit pattern as the reference's masked
# BigInt arithmetic — only right shifts need care (they are arithmetic
# here, logical there), hence `lsr`.

const XS_MULTIPLIER := 0x2545F4914F6CDD1D


## Logical (unsigned) shift right on the 64-bit pattern. `n` must be ≥ 1.
static func lsr(x: int, n: int) -> int:
	return (x >> n) & ((1 << (64 - n)) - 1)


## Initial state for one shuffle site. Never zero — xorshift is stuck
## at zero, so the FNV offset basis substitutes.
static func shuffle_seed(bank_seed: int, site_key: String) -> int:
	var state := bank_seed ^ fnv1a64(site_key)
	return state if state != 0 else OFFSET_BASIS


## One xorshift64* step: the new state (store this, never the output).
static func xorshift64_next(state: int) -> int:
	var x := state
	x = x ^ lsr(x, 12)
	x = x ^ (x << 25)
	x = x ^ lsr(x, 27)
	return x


## The variant a stepped state selects among `n` options: the multiplied
## output's top 32 bits mod `n` — non-negative in signed arithmetic.
static func shuffle_pick(state: int, n: int) -> int:
	return lsr(state * XS_MULTIPLIER, 32) % n
