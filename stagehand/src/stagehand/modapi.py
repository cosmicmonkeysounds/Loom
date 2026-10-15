"""Client for the event server — the one link every module shares.

Wire contract (core/server/event-runtime.ts):
  - auth: `x-loom-token` header; bootstrap `POST /api/mod/login {passcode}`
  - `POST /api/mod/signal {name, subject?}`
  - `POST /api/mod/beat   {name, subject?}`
  - `POST /api/mod/set    {id, field: "location", value}` — the arrive path
  - SSE mod feed: `GET /events?role=mod&id=stagehand`
  - alexa: `POST /api/mod/tts {text, voice?, speed?}` → audio bytes (mp3/wav)
  - agents: `GET /api/agent/stream?characters=…&name=…` (SSE) and
    `POST /api/agent/reply {id, say, adjust, worker}`

Event scoping: paths are `/e/<eventId>/...` unless the configured event
is "default"/empty, which targets the server's bare back-compat routes.

One `ModClient` per process: every module streams and posts through it,
so a token refreshed by one (the run restarted, the old token died) is
the token the others use next.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from .sse import SSEParser

log = logging.getLogger("stagehand.modapi")


class ModApiError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class ModClient:
    def __init__(
        self,
        base_url: str,
        event: str = "default",
        token: str | None = None,
        passcode: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.event = event
        self.token = token
        self.passcode = passcode
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=10.0)
        self._login = asyncio.Lock()

    def path(self, p: str) -> str:
        if self.event in ("", "default"):
            return p
        return f"/e/{self.event}{p}"

    @property
    def sse_url(self) -> str:
        return f"{self.base_url}{self.path('/events')}?role=mod&id=stagehand"

    async def ensure_token(self) -> None:
        """Exchange the mod passcode for a session token if needed."""
        async with self._login:
            if self.token is not None:
                return
            if self.passcode is None:
                raise ModApiError("no mod_token and no mod_passcode configured")
            r = await self._client.post(self.path("/api/mod/login"), json={"passcode": self.passcode})
            if r.status_code != 200:
                raise ModApiError(f"mod login failed: {r.status_code} {r.text}", r.status_code)
            self.token = r.json()["token"]
            log.info("mod login ok (token acquired)")

    def forget_token(self) -> None:
        """The server refused the token (the run restarted) — log in again next time.
        A configured static `mod_token` can't be refreshed, so it is kept."""
        if self.passcode is not None:
            self.token = None

    async def post(self, p: str, body: dict[str, Any]) -> dict[str, Any]:
        await self.ensure_token()
        r = await self._client.post(self.path(p), json=body, headers={"x-loom-token": self.token or ""})
        if r.status_code == 403 and self.passcode is not None:
            # Session may have been reset server-side — re-login once.
            self.forget_token()
            await self.ensure_token()
            r = await self._client.post(self.path(p), json=body, headers={"x-loom-token": self.token or ""})
        if r.status_code != 200:
            raise ModApiError(f"POST {p} → {r.status_code} {r.text}", r.status_code)
        try:
            doc = r.json()
        except json.JSONDecodeError:
            return {}
        return doc if isinstance(doc, dict) else {}

    async def get(self, p: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """One authenticated GET (`/api/agent/facts`); re-logs in once on 403."""
        await self.ensure_token()
        r = await self._client.get(self.path(p), params=params, headers={"x-loom-token": self.token or ""})
        if r.status_code == 403 and self.passcode is not None:
            self.forget_token()
            await self.ensure_token()
            r = await self._client.get(self.path(p), params=params, headers={"x-loom-token": self.token or ""})
        if r.status_code != 200:
            raise ModApiError(f"GET {p} → {r.status_code} {r.text}", r.status_code)
        try:
            doc = r.json()
        except json.JSONDecodeError:
            return {}
        return doc if isinstance(doc, dict) else {}

    async def speak(self, text: str, voice: str | None = None, speed: float | None = None, timeout: float = 10.0) -> tuple[bytes, str]:
        """The server's neural voice (`/api/mod/tts`) → (audio bytes, content type).
        Raises `ModApiError` on any non-200 (503 = no voice configured)."""
        await self.ensure_token()
        body: dict[str, Any] = {"text": text}
        if voice:
            body["voice"] = voice
        if speed is not None:
            body["speed"] = speed
        for attempt in (0, 1):
            r = await self._client.post(
                self.path("/api/mod/tts"), json=body, headers={"x-loom-token": self.token or ""}, timeout=timeout
            )
            if r.status_code == 403 and attempt == 0 and self.passcode is not None:
                self.forget_token()
                await self.ensure_token()
                continue
            break
        if r.status_code != 200:
            raise ModApiError(f"POST /api/mod/tts → {r.status_code} {r.text[:200]}", r.status_code)
        return r.content, r.headers.get("content-type", "")

    # -- mod mutations -------------------------------------------------------

    async def signal(self, name: str, subject: str | None = None) -> None:
        await self.post("/api/mod/signal", {"name": name, "subject": subject or ""})

    async def beat(self, name: str, subject: str | None = None) -> None:
        await self.post("/api/mod/beat", {"name": name, "subject": subject or ""})

    async def arrive(self, person: str, location: str) -> None:
        await self.post("/api/mod/set", {"id": person, "field": "location", "value": location})

    # -- streams -------------------------------------------------------------

    async def stream(self, url: str) -> AsyncIterator[tuple[str, str]]:
        """Open one authenticated SSE stream and yield `(event, data)` frames
        until it closes. Raises `ModApiError` (with `.status`) when refused —
        reconnect policy belongs to the caller (see `run_stream`)."""
        await self.ensure_token()
        headers = {"x-loom-token": self.token or ""}
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None)) as client:
            async with client.stream("GET", url, headers=headers) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    raise ModApiError(f"GET {url} → {resp.status_code} {resp.text[:200]}", resp.status_code)
                parser = SSEParser()
                async for chunk in resp.aiter_text():
                    for frame in parser.feed(chunk):
                        yield frame

    async def aclose(self) -> None:
        await self._client.aclose()


async def run_stream(
    client: ModClient,
    url: str,
    on_frame,  # Callable[[str, str], Awaitable[None] | None]
    *,
    label: str,
    on_connect=None,  # Callable[[], None] | None
    max_backoff: float = 30.0,
) -> None:
    """Hold an SSE stream forever: reconnect with exponential backoff, and
    drop a refused token so the next attempt logs in again."""
    backoff = 1.0
    while True:
        try:
            connected = False
            async for event, data in client.stream(url):
                if not connected:
                    connected = True
                    backoff = 1.0
                    log.info("%s connected: %s", label, url)
                    if on_connect is not None:
                        on_connect()
                result = on_frame(event, data)
                if asyncio.iscoroutine(result):
                    await result
            log.warning("%s stream closed — reconnecting in %.0fs", label, backoff)
        except ModApiError as err:
            if err.status in (401, 403):
                client.forget_token()
            log.warning("%s stream refused (%s) — retrying in %.0fs", label, err, backoff)
        except (httpx.HTTPError, OSError, json.JSONDecodeError) as err:
            log.warning("%s stream dropped (%s) — retrying in %.0fs", label, err, backoff)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, max_backoff)
