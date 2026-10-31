## Getting the headset to its display rate, and keeping it there.
##
## An app that has not asked runs at 72 Hz, whatever the display reads as its
## session starts: the shell's own 90 can still be showing at focus and fall to
## 72 a moment later (runtime 209.166, logged on 2026-10-31). So [method step]
## always asks once after focus, then keeps reading the display back. The runtime
## drops a repeat of the rate it was last asked for, so to ask again it asks for
## another rate first. Thermal throttling and Battery Saver can hold the display
## down, which no request beats, so it gives up after [constant TRIES].
##
## Battery Saver (Settings > General > Power) caps everything at 72 Hz, at 40%
## brightness: `LP=1` on the compositor's log line. It must be off on the night.
##
## Pure, so the tests pin it: `main.gd` writes what [method step] returns to
## [member OpenXRInterface.display_refresh_rate].
class_name RefreshRate
extends RefCounted

## The display rate to ask a headset for (Hz).
const WANT := 90.0
## How long (s) a request gets to take before it is asked again.
const WAIT := 1.0
## How long (s) to stay on the other rate before asking for the wanted one.
const KICK_WAIT := 0.25
## The asks before giving up (the game runs at whatever it was given).
const TRIES := 6
## Rates this close (Hz) are the same rate: the runtime's floats need not be
## exactly 90.0.
const SAME := 0.5

## The offered rate being held, 0 when none is.
var want := 0.0
## Requests for [member want] since the last focus.
var tries := 0

var _offered: Array = []
## The last rate asked for: a repeat of it would be dropped.
var _asked := 0.0
var _wait := 0.0


## The offered rate nearest `rate`, 0 with none on offer.
static func nearest(offered: Array, rate: float) -> float:
	var best := 0.0
	for r: float in offered:
		if best == 0.0 or absf(r - rate) < absf(best - rate):
			best = r
	return best


## An offered rate that is not `rate`, nearest `display` (so a kick changes the
## picture as little as it can), 0 when there is no other.
static func other(offered: Array, rate: float, display: float) -> float:
	var rest: Array = []
	for r: float in offered:
		if absf(r - rate) >= SAME:
			rest.append(r)
	return nearest(rest, display)


## Start working towards `rate` (the session has just gained focus).
func start(offered: Array, rate := WANT) -> void:
	_offered = offered.duplicate()
	want = nearest(offered, rate)
	tries = 0
	_wait = 0.0


## One frame of `delta` s with the display at `display`: the rate to ask for
## now, or 0 for nothing.
func step(display: float, delta: float) -> float:
	if want == 0.0:
		return 0.0
	_wait -= delta
	if _wait > 0.0:
		return 0.0
	var there := absf(display - want) < SAME
	var asked_it := absf(_asked - want) < SAME
	if there and (asked_it or tries > 0):
		return 0.0
	if tries >= TRIES:
		want = 0.0
		return 0.0
	if asked_it:
		var kick := other(_offered, want, display)
		if kick > 0.0:
			_asked = kick
			_wait = KICK_WAIT
			return kick
	_asked = want
	_wait = WAIT
	tries += 1
	return want
