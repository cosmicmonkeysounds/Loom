"""The MQTT side: a paho client on its own network thread, bridged into
asyncio via a queue.

Stagehand announces itself on `health/stagehand` (retained "online",
broker-set LWT "lost") so the Run-mode tech rail can watch the bridge
the same way it watches every prop. Another module on its own client
(the `alexa` player) passes its own `health_topic` so the two never
overwrite each other's status.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

import paho.mqtt.client as paho

log = logging.getLogger("stagehand.mqtt")

HEALTH_TOPIC = "health/stagehand"


class MqttBridge:
    def __init__(
        self,
        host: str,
        port: int,
        filters: list[str],
        loop: asyncio.AbstractEventLoop,
        client_id: str = "stagehand",
        username: str | None = None,
        password: str | None = None,
        health_topic: str = HEALTH_TOPIC,
    ) -> None:
        self._filters = filters
        self._health = health_topic
        self._loop = loop
        #: (topic, payload, retained) — `retained` is True for a message the
        #: broker replayed on (re)subscribe, so the sensor map can ignore it.
        self.queue: asyncio.Queue[tuple[str, bytes, bool]] = asyncio.Queue()
        #: Set while the broker session is up. paho drops queued QoS-0
        #: publishes when it reconnects, so a replay waits on this.
        self.connected = asyncio.Event()
        #: Called on the loop after every (re)connect — the show router
        #: catches the lights up then, since cues sent meanwhile were lost.
        self.on_connected: Callable[[], None] | None = None
        self._client = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=client_id, clean_session=True)
        if username is not None:
            self._client.username_pw_set(username, password)
        self._client.will_set(health_topic, "lost", retain=True)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message
        self._host = host
        self._port = port

    # paho callbacks run on the network thread — hop to the loop.

    def _on_connect(self, client: paho.Client, _userdata, _flags, reason_code, _props) -> None:
        if getattr(reason_code, "is_failure", False):
            log.warning("mqtt connect refused (%s) — paho will retry", reason_code)
            return
        log.info("mqtt connected (%s)", reason_code)
        client.publish(self._health, "online", retain=True)
        for f in self._filters:
            client.subscribe(f)
            log.info("mqtt subscribed %s", f)
        self._loop.call_soon_threadsafe(self._session_up)

    def _session_up(self) -> None:
        self.connected.set()
        if self.on_connected is not None:
            self.on_connected()

    def _on_disconnect(self, _client, _userdata, _flags, reason_code, _props) -> None:
        log.warning("mqtt disconnected (%s) — paho will retry", reason_code)
        try:
            self._loop.call_soon_threadsafe(self.connected.clear)
        except RuntimeError:  # the loop already closed (shutdown)
            pass

    def _on_message(self, _client, _userdata, msg: paho.MQTTMessage) -> None:
        self._loop.call_soon_threadsafe(self.queue.put_nowait, (msg.topic, msg.payload, bool(msg.retain)))

    def start(self) -> None:
        self._client.connect_async(self._host, self._port)
        self._client.loop_start()

    def stop(self) -> None:
        try:
            self._client.publish(self._health, "offline", retain=True).wait_for_publish(timeout=2)
        except (RuntimeError, ValueError):
            pass
        self._client.disconnect()
        self._client.loop_stop()

    def publish(self, topic: str, payload: str, retain: bool = False, qos: int = 0) -> None:
        self._client.publish(topic, payload, qos=qos, retain=retain)
