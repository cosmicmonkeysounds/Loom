## Getting the headset to its display rate, and knowing that it got there.
##
## What a Quest 3 does (runtime 209.166, logged on 2026-10-31): the rates are
## offered before the session runs, and a request made then is accepted and
## lost. Worse, the runtime drops a repeat of the rate it was last asked for
## (no `SetDisplayRefreshRate` line in the log at all), so an app that asked
## too early can ask again on every focus and stay at 72 Hz for ever.
##
## So: ask only once the session has focus, read the display back, and when it
## has not moved, ask for another rate first, so that the wanted one is a new
## request again. Pure, so the tests pin it: `main.gd` writes what
## [method step] returns to [member OpenXRInterface.display_refresh_rate].
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

## The offered rate being worked towards, 0 when none is.
var want := 0.0
## Requests for [member want] so far.
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
	if absf(display - want) < SAME:
		want = 0.0
		return 0.0
	_wait -= delta
	if _wait > 0.0:
		return 0.0
	if tries >= TRIES:
		want = 0.0
		return 0.0
	if absf(_asked - want) < SAME:
		var kick := other(_offered, want, display)
		if kick > 0.0:
			_asked = kick
			_wait = KICK_WAIT
			return kick
	_asked = want
	_wait = WAIT
	tries += 1
	return want
