## The intro before a walk (wave 33): the reinstallation video, then a
## gentle tutorial — most guests have never worn a headset, and the Quest
## has only its RIGHT controller. Pure, like [GameFlow]: [Game] feeds it a
## frame's inputs ([method tick]) and button presses, and acts on the
## events it hands back; [IntroSpace] draws what [method title], [method
## body] and [method buttons] say.
##
## The steps, in order (each advances when the guest does the thing, with a
## fallback button after a few seconds when they are stuck):
##
## - **VIDEO** — the reinstallation video on a cinema screen. Unskippable
##   until the program has completed a reinstallation ([member skippable]:
##   the assignment's `reinstalled` ≥ 1), then a SKIP button.
## - **WELCOME** — look around (≥ [constant LOOK_DEG] of head turn), or OK
##   (shown after [constant WELCOME_OK_AFTER] s).
## - **POINT** — point the beam at the big OK and pull the trigger.
## - **WALK** — walk into the glowing ring; NEXT after [constant WALK_NEXT_AFTER] s.
## - **TURN** — SNAP TURN / SMOOTH TURN switch the setting live; turn
##   around to face the duck behind you; KEEP THIS ONE saves the choice
##   (shown once the duck is faced, or after [constant TURN_KEEP_AFTER] s).
## - **COMFORT** — what to do when dizzy; START.
##
## A returning program ([member skippable]) may also skip the whole
## tutorial. Events (`{event: …}`): `step` (entered `step`), `success` (the
## guest did the thing: a chime and a gentle haptic), `turn` (apply `turn`
## now), `save` (keep `turn`: [method LinkBase.save_prefs]), `done`.
class_name IntroFlow
extends RefCounted

enum Step { VIDEO, WELCOME, POINT, WALK, TURN, COMFORT, DONE }

## Head turn (degrees, summed) that counts as having looked around.
const LOOK_DEG := 100.0
const WELCOME_OK_AFTER := 5.0
const WALK_NEXT_AFTER := 20.0
const TURN_KEEP_AFTER := 15.0
## A press this soon after a step starts is ignored: the pull that pressed
## the last button never presses the next one.
const ARM_DELAY := 0.6
## The ring counts as reached within this (plan m) of its centre.
const RING_RADIUS := 0.6
## The duck counts as faced within this many degrees of the head's yaw.
const FACE_DEG := 30.0

# DRAFT w33 — every string below awaits sign-off.
const TITLES := {
	Step.WELCOME: "WELCOME",  # DRAFT w33
	Step.POINT: "POINTING",  # DRAFT w33
	Step.WALK: "WALKING",  # DRAFT w33
	Step.TURN: "TURNING",  # DRAFT w33
	Step.COMFORT: "YOU'RE READY",  # DRAFT w33
}
const BODIES := {
	Step.WELCOME: "Take a look around — turn your head slowly.\nYou can take the headset off any time.",  # DRAFT w33
	Step.POINT: "Your controller makes a beam.\nPoint it at the button and pull the trigger\nunder your finger.",  # DRAFT w33
	Step.WALK: "Push the thumbstick forward gently to walk.\nWalk into the glowing circle.",  # DRAFT w33
	Step.TURN: "Push the thumbstick left or right to turn.\nTurn around to face the duck behind you.",  # DRAFT w33
	Step.COMFORT: "Feeling dizzy? Stop, stand still and close your\neyes for a moment. Now find Gerald, the golden duck.",  # DRAFT w33
}
## The TURN step once the duck is faced.
const TURN_DONE := "That's it! Try the other one if you like,\nthen keep the one that feels best."  # DRAFT w33
## Button labels (ids → text).
const LABELS := {
	"skip": "SKIP ▶",  # DRAFT w33
	"skip_tutorial": "SKIP TUTORIAL ▶",  # DRAFT w33
	"ok": "OK",  # DRAFT w33
	"next": "NEXT ▶",  # DRAFT w33
	"snap": "SNAP TURN",  # DRAFT w33
	"smooth": "SMOOTH TURN",  # DRAFT w33
	"keep": "KEEP THIS ONE ▶",  # DRAFT w33
	"start": "START ▶",  # DRAFT w33
}
## Under the turn buttons.
const SNAP_NOTE := "jumps in small steps —\neasiest on the stomach"  # DRAFT w33
const SMOOTH_NOTE := "glides around"  # DRAFT w33

var step := Step.DONE
## The video and the tutorial may be skipped (a program that has completed
## a reinstallation before).
var skippable := false
## The turn setting picked: "snap" or "smooth".
var turn := "snap"
## The duck behind was faced in the TURN step.
var faced := false
## Seconds into the current step.
var t := 0.0
var _looked := 0.0
var _last_yaw: Variant = null


## Whether `reinstalled` (the assignment's count of ducks found since the
## story started; missing on an old server) lets the program skip.
static func skippable_for(reinstalled: Variant) -> bool:
	return (reinstalled is int or reinstalled is float) and int(reinstalled) >= 1


## The turn setting a program's saved `prefs` names ("snap" / "smooth"),
## else "" (none saved, an old server, junk).
static func saved_turn(prefs: Variant) -> String:
	if not prefs is Dictionary:
		return ""
	var t: Variant = (prefs as Dictionary).get("turn")
	return str(t) if t is String and str(t) in ["snap", "smooth"] else ""


## Start at the video: `reinstalled` decides the skips, `turn_now` is the
## setting in force ("snap" / "smooth"). Returns the first events.
func start(reinstalled: Variant, turn_now: String) -> Array:
	skippable = skippable_for(reinstalled)
	turn = "smooth" if turn_now == "smooth" else "snap"
	faced = false
	_looked = 0.0
	_last_yaw = null
	return _enter(Step.VIDEO)


func running() -> bool:
	return step != Step.DONE


## Stop where it is (the session ended): no events.
func abort() -> void:
	step = Step.DONE


## Whether the guest walks and turns in this step (off for the video and
## the pointing steps).
func locomotion() -> bool:
	return step in [Step.WALK, Step.TURN, Step.COMFORT]


## One frame: `inp` `{yaw: head yaw (deg), video_done: bool, in_ring: bool,
## facing: bool, pressed: button id or ""}`. Returns the events.
func tick(delta: float, inp: Dictionary) -> Array:
	if step == Step.DONE:
		return []
	t += delta
	var out: Array = []
	var yaw: Variant = inp.get("yaw")
	if yaw is float or yaw is int:
		if _last_yaw != null:
			_looked += absf(wrapf(float(yaw) - float(_last_yaw), -180.0, 180.0))
		_last_yaw = float(yaw)
	var pressed := str(inp.get("pressed", ""))
	if pressed != "":
		out.append_array(press(pressed))
		if step == Step.DONE:
			return out
	match step:
		Step.VIDEO:
			if inp.get("video_done") == true:
				out.append_array(_enter(Step.WELCOME))
		Step.WELCOME:
			if _looked >= LOOK_DEG:
				out.append({"event": "success"})
				out.append_array(_enter(Step.POINT))
		Step.WALK:
			if inp.get("in_ring") == true:
				out.append({"event": "success"})
				out.append_array(_enter(Step.TURN))
		Step.TURN:
			if not faced and inp.get("facing") == true:
				faced = true
				out.append({"event": "success"})
	return out


## A button press (`id` from [method buttons]); returns the events. A
## button not shown, or pressed within [constant ARM_DELAY] of the step's
## start, does nothing.
func press(id: String) -> Array:
	if not id in buttons() or t < ARM_DELAY:
		return []
	match id:
		"skip":
			return _enter(Step.WELCOME)
		"skip_tutorial":
			return _enter(Step.DONE)
		"snap", "smooth":
			if id == turn:
				return []
			turn = id
			return [{"event": "turn", "turn": turn}]
		"keep":
			var out: Array = [{"event": "save", "turn": turn}, {"event": "success"}]
			out.append_array(_enter(Step.COMFORT))
			return out
		"ok", "next", "start":
			var nxt: Step = (step + 1) as Step
			var out: Array = [{"event": "success"}]
			out.append_array(_enter(nxt))
			return out
	return []


## The buttons up now (ids, in [constant LABELS]).
func buttons() -> Array:
	var out: Array = []
	match step:
		Step.VIDEO:
			if skippable:
				out.append("skip")
			return out
		Step.WELCOME:
			if t >= WELCOME_OK_AFTER:
				out.append("ok")
		Step.POINT:
			out.append("ok")
		Step.WALK:
			if t >= WALK_NEXT_AFTER:
				out.append("next")
		Step.TURN:
			out.append_array(["snap", "smooth"])
			if faced or t >= TURN_KEEP_AFTER:
				out.append("keep")
		Step.COMFORT:
			out.append("start")
		Step.DONE:
			return out
	if skippable:
		out.append("skip_tutorial")
	return out


func title() -> String:
	return str(TITLES.get(step, ""))


func body() -> String:
	if step == Step.TURN and faced:
		return TURN_DONE
	return str(BODIES.get(step, ""))


## "2 / 5" in the tutorial, "" for the video.
func progress() -> String:
	if step == Step.VIDEO or step == Step.DONE:
		return ""
	return "%d / %d" % [int(step), int(Step.COMFORT)]


func _enter(s: Step) -> Array:
	step = s
	t = 0.0
	if s == Step.WELCOME:
		_looked = 0.0
	if s == Step.TURN:
		faced = false
	var out: Array = [{"event": "step", "step": s}]
	if s == Step.DONE:
		out.append({"event": "done"})
	return out


## Whether feet `feet` (world) stand in the ring at `ring` (world, plan).
static func in_ring(feet: Vector3, ring: Vector3) -> bool:
	return Vector2(feet.x - ring.x, feet.z - ring.z).length() <= RING_RADIUS


## Whether a head at `head` (world) with yaw `yaw` (deg, world: 0 faces −z)
## faces `target` within [constant FACE_DEG].
static func facing(yaw: float, head: Vector3, target: Vector3) -> bool:
	var d := target - head
	if Vector2(d.x, d.z).length() < 0.01:
		return true
	var want := rad_to_deg(atan2(-d.x, -d.z))
	return absf(wrapf(want - yaw, -180.0, 180.0)) <= FACE_DEG


static func name_of(s: Step) -> String:
	return ["VIDEO", "WELCOME", "POINT", "WALK", "TURN", "COMFORT", "DONE"][s]
