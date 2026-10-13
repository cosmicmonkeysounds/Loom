## The latest-only pose pump (§3 / §5): at most one pose in flight, at most
## one waiting, sent no more often than every 100 ms. A newer pose
## *replaces* the waiting one — poses are never queued, so a slow network
## costs freshness, never a growing backlog.
##
## It also schedules the `found` claim: [method want_claim] stops the
## regular schedule, the newest pose is flushed once, and the claim goes as
## soon as that has landed — then no pose goes until [method claim_done],
## so nothing moves the player between the flushed pose and the server
## judging the claim. (Interleaving the claim with the 10 Hz schedule
## starved it: whenever a round trip took 100 ms or more, the next pose
## always went first.)
##
## Pure: [method step] returns what to send now; the caller sends it and
## reports back with [method sent] / [method claim_done], passing the
## [method generation] it captured at send time — a callback from before a
## [method clear] (an ended session's late answer) changes nothing.
## [ServerLink] drives it from `_process`; the tests drive it with a fake
## clock.
class_name PosePump
extends RefCounted

## Seconds between sends (10 Hz).
const INTERVAL := 0.1

enum Claim { NONE, WANTED, FLUSHED, OUT }

var _pending: Variant = null
var _in_flight := false
var _since := INTERVAL
var _claim := Claim.NONE
var _gen := 0


## Offer the newest pose (any value — the body to send). Replaces a waiting one.
func offer(pose: Variant) -> void:
	_pending = pose


## Advance the clock; returns the pose to send now, or `null` (the regular
## schedule only — [method step] also runs a claim).
func tick(delta: float) -> Variant:
	_since += delta
	if _in_flight or _pending == null or _since < INTERVAL:
		return null
	var pose: Variant = _pending
	_pending = null
	_in_flight = true
	_since = 0.0
	return pose


## The waiting pose, sent now whatever the interval (`null` when none
## waits or one is in flight).
func flush() -> Variant:
	if _in_flight or _pending == null:
		return null
	var pose: Variant = _pending
	_pending = null
	_in_flight = true
	_since = 0.0
	return pose


## Advance the clock; returns `{pose, claim}`: the pose to send now (or
## `null`) and whether to send the `found` claim now.
func step(delta: float) -> Dictionary:
	match _claim:
		Claim.NONE:
			return {"pose": tick(delta), "claim": false}
		Claim.OUT:
			_since += delta
			return {"pose": null, "claim": false}
	_since += delta
	if _in_flight:
		return {"pose": null, "claim": false}
	if _claim == Claim.WANTED:
		_claim = Claim.FLUSHED
		var newest: Variant = flush()
		if newest != null:
			return {"pose": newest, "claim": false}
	_claim = Claim.OUT
	return {"pose": null, "claim": true}


## Claim the duck: flush the newest pose, then [method step] says to claim.
func want_claim() -> void:
	if _claim == Claim.NONE:
		_claim = Claim.WANTED


## The claim's answer arrived (`gen` = [method generation] when it was sent):
## the regular schedule resumes.
func claim_done(gen: int) -> void:
	if gen == _gen and _claim == Claim.OUT:
		_claim = Claim.NONE


## Whether a claim is wanted or waiting for its answer.
func is_claiming() -> bool:
	return _claim != Claim.NONE


## The send that started at generation `gen` finished (whatever the outcome).
func sent(gen: int) -> void:
	if gen == _gen:
		_in_flight = false


func generation() -> int:
	return _gen


func is_in_flight() -> bool:
	return _in_flight


func has_pending() -> bool:
	return _pending != null


## Drop everything (the session ended). Answers to sends from before are
## ignored from now on.
func clear() -> void:
	_gen += 1
	_pending = null
	_in_flight = false
	_since = INTERVAL
	_claim = Claim.NONE
