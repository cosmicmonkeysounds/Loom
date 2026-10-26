## The game's view of the event server — the contract between [Game] and
## the `ServerLink` autoload, so the tests can hand the game a fake.
##
## Every call is fire-and-forget; answers come back as signals. Positions
## crossing this boundary are in **house coordinates** (`[x, y, z]`, the
## feet), yaw / pitch in degrees (§1 convention).
class_name LinkBase
extends Node

## A human-readable connection state for the lobby ("Connected to …").
signal status_changed(text: String)
## A program was assigned to this station (by the tablet, or by our own
## [method begin]). The game calls [method adopt] when it takes it.
signal assignment_received(assignment: Dictionary)
## [method begin] failed; `message` is for the lobby.
signal begin_failed(message: String)
## `players`: `[{id, name, captured, location}]`, captured first.
signal candidates_received(players: Array)
## The house map to build (the bundled fallback first, the server's when fetched).
signal house_loaded(house: Dictionary, version: String)
## The answer to [method report_found]: `ok` false = "not near the duck" (keep playing).
signal found_answered(ok: bool, data: Dictionary)
## The server ended our session ("over", "replaced", "timeout", "reset").
signal session_over(reason: String)
## The server moved (or re-dealt) the adopted session's duck after a map
## edit — from the map fetch made with the session token, or a `duck
## {session, duck}` stream frame. `duck` is the new `DuckSpot`.
signal duck_changed(duck: Dictionary)
## The map in play may not be the event's (the fetch failed and the bundled
## or an older map is up, or the server's map moved on): `text` for the
## HUD; `""` once the event's map is in again.
signal map_warning(text: String)
## The shared King changed (`KingState` `{id, hp, max, fallen, by}`, or
## `{}`: no shared King — an old server, or none on the map): from the
## `hello` / `king` frames, the session's map fetch, or a hit's answer.
signal king_changed(king: Dictionary)
## The answer to [method hit_king]: `result` "ok" | "already hit" (this
## visit already hit) | "not near" | "fallen" | "doors are closed" |
## "no king" | "error"; `data` the reply ([member king] is already updated).
signal king_hit_answered(result: String, data: Dictionary)
## The answer to [method moment] (wave 26, C6): `kind` "escape" | "heart"
## | "pickup" and `result` — "ok" (`data` is the 200 body: `lines`, and
## `spawn` / `cooldownMs` or `item` / `prop`) · "not found" (an old server
## with no such route) · "no such prop" · "bad moment" · "doors are closed"
## · "parked" (no pose yet) · "not out" · "cooldown" · "sealed" ·
## "not there" · "far" · "already" · "offline" (no server) · "error".
## A dead session (401 / 410) ends the game through [signal session_over].
signal moment_answered(kind: String, result: String, data: Dictionary)
## A raw spatial stream frame (`hello`, `join`, `poses`, `leave`, …) for the ghosts.
signal stream_frame(event: String, data: Variant)
## The answer to [method try_setup]: `ok`, else `message` for the SET UP
## panel ("That isn't a moderator passcode." / "Can't reach the server.").
signal setup_answered(ok: bool, message: String)

## The station's configuration ([StationConfig]).
var config: Dictionary = StationConfig.defaults()
## The current house map (`{}` until loaded) and its version.
var house: Dictionary = {}
var house_version := ""
## The adopted assignment (`{}` when not playing).
var session: Dictionary = {}
## The last status text.
var status := ""
## The shared King ([signal king_changed]; `{}` = none).
var king: Dictionary = {}
## The map warning in force ([signal map_warning]; `""` = the event's map is up).
var map_warning_text := ""


## Ask the server to start `guest` on this station.
func begin(_guest: String) -> void:
	pass


## Take an assignment: from now on poses and found go to its session.
func adopt(assignment: Dictionary) -> void:
	session = assignment


## Refresh the candidate list ([signal candidates_received]).
func request_candidates() -> void:
	pass


## Offer the newest pose (latest-only; never queued).
func send_pose(_p: Array, _yaw: float, _pitch: float) -> void:
	pass


## Claim the duck ([signal found_answered]).
func report_found() -> void:
	pass


## Hit the King ([signal king_hit_answered]) — once per visit, judged by
## the server on the newest pose.
func hit_king() -> void:
	pass


## Post a game moment (wave 26, C6, `POST /api/spatial/moment`): `kind`
## "escape" (the void), "heart" or "pickup" with the prop's id — judged by
## the server on the newest pose, which goes first ([signal moment_answered]).
func moment(_kind: String, _prop := "") -> void:
	pass


## The URL of an avatar key's picture (`/e/<event>/api/avatar/<key>`), ""
## when there is none to fetch (offline, no key).
func avatar_url(_key: String) -> String:
	return ""


## The event's spatial root for the terminals' camera feeds
## (`http://…/e/<event>/api/spatial`; [CamFeeds] adds `/cams` and
## `/cam?spot=`), "" when there are none to fetch (offline).
func cams_url() -> String:
	return ""


## The token the camera feeds are fetched with — the one the map is
## fetched with: the session's while playing, else the moderator's.
func cams_token() -> String:
	return ""


# --- voice ---


## The voice link's stream for the playing session
## (`http://…/e/<event>/api/spatial/voice/stream?token=<session>`), "" when
## there is none (offline, no session).
func voice_stream_url() -> String:
	return ""


## Where the voice chunks go (`http://…/e/<event>/api/spatial/voice`), "" offline.
func voice_upload_url() -> String:
	return ""


## The voice link's token: the playing session's ("" = none).
func voice_token() -> String:
	return ""


## End our session (found + celebrated, headset off, …).
func end_session(_reason: String) -> void:
	session = {}


func session_id() -> String:
	return str(session.get("session", ""))


func has_session() -> bool:
	return not session.is_empty()


func station_name() -> String:
	return str(config.get("name", "Headset"))


# --- in-headset setup (wave 19): no-op defaults, so fakes keep working ---------


## Whether the lobby should show the SET UP panel: no passcode yet, not offline.
func needs_setup() -> bool:
	return false


## Whether the event link is up (the lobby says [member status] instead of
## "Nobody is marked…" while it isn't).
func linked() -> bool:
	return true


## The SET UP panel's NAME to start with.
func default_station_name() -> String:
	return StationConfig.DEFAULT_NAME


## The servers the SET UP panel offers (`[{url, label}]`, first = default).
func server_choices() -> Array:
	return []


## Try `server` + moderator passcode `code` as station `name`
## ([signal setup_answered]); a working one is saved to `user://station.json`.
func try_setup(_server: String, _code: String, _name: String) -> void:
	pass


## Play without a server for this run (the SET UP panel's PLAY OFFLINE).
func play_offline() -> void:
	pass


## Whether there is a setup to forget (a saved file, or offline chosen here).
func can_forget_setup() -> bool:
	return false


## Forget the saved setup (⚙): back to the SET UP panel.
func forget_setup() -> void:
	pass


## Take a new configuration without a restart ([method reconnect] dials it).
func configure(cfg: Dictionary) -> void:
	config = cfg


## Drop any link and dial [member config] again.
func reconnect() -> void:
	pass


func _set_status(text: String) -> void:
	status = text
	status_changed.emit(text)


## Take the shared King's state off the wire ([method HouseKing.state_of]);
## emits [signal king_changed] when what it shows changed.
func _adopt_king(k: Variant) -> void:
	var next := HouseKing.state_of(k)
	if not HouseKing.changed(king, next):
		if not next.is_empty():
			king = next
		return
	king = next
	king_changed.emit(king)


## Parse and emit a map from a JSON string; false when it isn't one.
func _load_house_text(text: String, version: String) -> bool:
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary or not (parsed as Dictionary).has("rooms"):
		return false
	house = parsed
	house_version = version
	house_loaded.emit(house, house_version)
	return true
