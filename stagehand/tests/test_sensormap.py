import pytest

from stagehand.show.sensormap import Debouncer, ModCall, SensorMapError, evaluate_sensors, parse_sensor_rule


def rules(*raws):
    return [parse_sensor_rule(raw, i) for i, raw in enumerate(raws)]


PROXIMITY = {"on": {"topic": "sensors/crawlspace/proximity", "when": "near == true"}, "signal": {"name": "tv_approached", "debounce_s": 10}}
TAMPER = {"on": {"topic": "vision/{cam}/tamper"}, "signal": {"name": "camera_tampered", "subject": "{cam}"}}
ZONE_ID = {"on": {"topic": "vision/{cam}/zone", "when": "guest != null && event == 'entered'"}, "arrive": {"person": "{guest}", "location": "{zone}"}}
ZONE_ANON = {"on": {"topic": "vision/{cam}/zone", "when": "guest == null && event == 'entered'"}, "signal": {"name": "movement", "subject": "{zone}"}}


def test_when_gates():
    rs = rules(PROXIMITY)
    d = Debouncer()
    assert evaluate_sensors(rs, "sensors/crawlspace/proximity", {"near": False}, d, 0.0) == []
    calls = evaluate_sensors(rs, "sensors/crawlspace/proximity", {"near": True}, d, 0.0)
    assert calls == [ModCall(kind="signal", fields={"name": "tv_approached"})]


def test_topic_capture_into_subject():
    calls = evaluate_sensors(rules(TAMPER), "vision/cam_kitchen/tamper", {"kind": "covered"}, Debouncer(), 0.0)
    assert calls == [ModCall(kind="signal", fields={"name": "camera_tampered", "subject": "cam_kitchen"})]


def test_identified_vs_anonymous_zone():
    rs = rules(ZONE_ID, ZONE_ANON)
    d = Debouncer()
    identified = evaluate_sensors(rs, "vision/cam_hall/zone", {"zone": "Hallway", "event": "entered", "guest": "g_1"}, d, 0.0)
    assert identified == [ModCall(kind="arrive", fields={"person": "g_1", "location": "Hallway"})]
    anonymous = evaluate_sensors(rs, "vision/cam_hall/zone", {"zone": "Hallway", "event": "entered", "guest": None}, d, 0.0)
    assert anonymous == [ModCall(kind="signal", fields={"name": "movement", "subject": "Hallway"})]
    left = evaluate_sensors(rs, "vision/cam_hall/zone", {"zone": "Hallway", "event": "left", "guest": "g_1"}, d, 0.0)
    assert left == []


def test_debounce_window():
    rs = rules(PROXIMITY)
    d = Debouncer()
    assert len(evaluate_sensors(rs, "sensors/crawlspace/proximity", {"near": True}, d, 0.0)) == 1
    assert len(evaluate_sensors(rs, "sensors/crawlspace/proximity", {"near": True}, d, 5.0)) == 0
    assert len(evaluate_sensors(rs, "sensors/crawlspace/proximity", {"near": True}, d, 10.5)) == 1


def test_debounce_is_per_identity():
    tamper = {"on": {"topic": "vision/{cam}/tamper"}, "signal": {"name": "camera_tampered", "subject": "{cam}", "debounce_s": 30}}
    rs = rules(tamper)
    d = Debouncer()
    assert len(evaluate_sensors(rs, "vision/cam_a/tamper", {}, d, 0.0)) == 1
    assert len(evaluate_sensors(rs, "vision/cam_b/tamper", {}, d, 1.0)) == 1  # different camera fires
    assert len(evaluate_sensors(rs, "vision/cam_a/tamper", {}, d, 2.0)) == 0  # same camera debounced


def test_unfilled_template_skips_action():
    rs = rules({"on": {"topic": "sensors/x/y"}, "signal": {"name": "s", "subject": "{nope}"}})
    assert evaluate_sensors(rs, "sensors/x/y", {}, Debouncer(), 0.0) == []


def test_beat_action():
    rs = rules({"on": {"topic": "sensors/door/open"}, "beat": {"name": "doors_open"}})
    calls = evaluate_sensors(rs, "sensors/door/open", {"value": 1}, Debouncer(), 0.0)
    assert calls == [ModCall(kind="beat", fields={"name": "doors_open"})]


def test_validation():
    with pytest.raises(SensorMapError):
        parse_sensor_rule({"on": {"topic": "a/b"}}, 0)  # no action
    with pytest.raises(SensorMapError):
        parse_sensor_rule({"on": {}}, 0)  # no topic
    with pytest.raises(SensorMapError):
        parse_sensor_rule({"on": {"topic": "a/b", "when": "a =="}, "signal": {"name": "x"}}, 0)  # bad condition
    with pytest.raises(SensorMapError):
        parse_sensor_rule({"on": {"topic": "a/b"}, "arrive": {"person": "p"}}, 0)  # missing location
    with pytest.raises(SensorMapError):
        parse_sensor_rule({"on": {"topic": "a/b"}, "signal": {"name": "x", "bogus": 1}}, 0)  # unknown key
    with pytest.raises(SensorMapError):
        parse_sensor_rule({"on": {"topic": "a/b"}, "edge": True, "signal": {"name": "x"}}, 0)  # edge needs a when:
    with pytest.raises(SensorMapError):
        parse_sensor_rule({"on": {"topic": "a/b", "when": "x == 1"}, "edge": "yes", "signal": {"name": "x"}}, 0)


# -- edge + retained (a door contact that republishes its state) -------------------

DOOR = {"on": {"topic": "sensors/serverroom/door", "when": "open == true"}, "edge": True, "signal": {"name": "server_door_opened"}}


def _door(rs, d, payload, now, retained=False):
    return [c.fields["name"] for c in evaluate_sensors(rs, "sensors/serverroom/door", payload, d, now, retained=retained)]


def test_edge_fires_once_per_opening_however_often_open_is_republished():
    rs, d = rules(DOOR), Debouncer()
    assert _door(rs, d, {"open": True}, 0.0) == ["server_door_opened"]  # first open after boot fires
    assert _door(rs, d, {"open": True}, 60.0) == []  # a battery / link report repeating "open"
    assert _door(rs, d, {"open": True, "battery": 90}, 120.0) == []
    assert _door(rs, d, {"open": False}, 130.0) == []
    assert _door(rs, d, {"open": True}, 131.0) == ["server_door_opened"]  # a real second opening


def test_edge_ignores_a_message_that_does_not_mention_the_field():
    rs, d = rules(DOOR), Debouncer()
    assert _door(rs, d, {"open": True}, 0.0) == ["server_door_opened"]
    assert _door(rs, d, {"battery": 80}, 1.0) == []  # says nothing about the door: level kept…
    assert _door(rs, d, {"open": True}, 2.0) == []  # …so this is not a new opening


def test_retained_messages_never_fire_but_prime_the_edge():
    rs, d = rules(DOOR), Debouncer()
    # stagehand restarts with the door propped open: the broker replays the retained "open"
    assert _door(rs, d, {"open": True}, 0.0, retained=True) == []
    assert _door(rs, d, {"open": True}, 30.0) == []  # the next live republish is not an edge either
    assert _door(rs, d, {"open": False}, 40.0) == []
    assert _door(rs, d, {"open": True}, 41.0) == ["server_door_opened"]


def test_retained_is_ignored_on_plain_rules_unless_accepted():
    plain = rules(PROXIMITY)
    assert evaluate_sensors(plain, "sensors/crawlspace/proximity", {"near": True}, Debouncer(), 0.0, retained=True) == []
    accepting = rules({**PROXIMITY, "accept_retained": True})
    assert len(evaluate_sensors(accepting, "sensors/crawlspace/proximity", {"near": True}, Debouncer(), 0.0, retained=True)) == 1


def test_edge_level_is_per_topic_and_debounce_still_applies():
    rule = {"on": {"topic": "sensors/{room}/door", "when": "open == true"}, "edge": True, "signal": {"name": "door", "subject": "{room}", "debounce_s": 10}}
    rs, d = rules(rule), Debouncer()
    a = evaluate_sensors(rs, "sensors/a/door", {"open": True}, d, 0.0)
    b = evaluate_sensors(rs, "sensors/b/door", {"open": True}, d, 0.5)
    assert [c.fields["subject"] for c in a + b] == ["a", "b"]
    evaluate_sensors(rs, "sensors/a/door", {"open": False}, d, 1.0)
    assert evaluate_sensors(rs, "sensors/a/door", {"open": True}, d, 2.0) == []  # an edge, but inside the debounce
