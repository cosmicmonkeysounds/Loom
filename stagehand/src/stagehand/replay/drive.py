"""Driving a run: the lock, the rig check, the scratch server + worker, the
console mirror, the script driver, and `offline` (CONTRACTS.md §C7.1).

Safety, in code:

- the server is a **no-DB scratch server** on a port of the lane's block
  (7920–7929), bound to 127.0.0.1, with a fresh `LOOM_STATE_DIR` under the
  run directory and passcodes the harness sets;
- the worker runs `stagehand run --config <generated yaml> --only agents`
  with `LOOM_SERVER_URL` / `LOOM_EVENT_ID` / `LOOM_MOD_*` forced to the
  scratch server, so no environment can point it at a real show;
- both are started in their own process group and stopped by **that group
  only** (`os.killpg` on the PID the harness started);
- no model traffic before `/…/w12/ollama.lock` is held (mkdir; a pid file
  inside), and none while any `Trabolta.trace.jsonl` in the main checkout's
  `stagehand/.stagehand-minds/` moved in the last 10 minutes (the user's rig
  is live or rehearsing). The launchd jobs are never touched.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal as signals
import socket
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import yaml

from . import score as scoring
from .sources import (
    CHARACTER,
    FINALE,
    WORKTREE,
    Facts,
    Redactor,
    ScriptError,
    catchphrases,
    chain_cues,
    extract,
    hold_lines,
    load_show_persona,
    main_checkout,
    persona_path,
    read_jsonl,
    resolve,
    scoring_answer_words,
    self_pressed,
    step_kind,
)

SCRATCH = Path("/private/tmp/claude-501/-Users-jjm-Documents-prism-root-packages-loom/13e70ce3-885f-4913-a37a-84a01505ca3b/scratchpad/w12")
RUNS_ROOT = Path(os.environ.get("LOOM_REPLAY_RUNS") or SCRATCH / "H" / "runs")
LOCK = Path(os.environ.get("LOOM_REPLAY_LOCK") or SCRATCH / "ollama.lock")
PORTS = range(7920, 7930)
REPLY_CAP_S = 150.0
BURST_CAP_S = 600.0
#: A burst is over once its end condition held this long (the hub's
#: follow-up request opens right after a reply lands: typing off → the
#: reply → typing on arrive back to back).
BURST_SETTLE_S = 2.0
RIG_WINDOW_S = 600.0
CODES = {"event": "GST{port}", "mod": "MOD{port}", "prime": "PRM{port}"}

#: The house settings for the voice (laptop.yaml's, so nothing reloads the model).
HOUSE_LLM: dict[str, Any] = {
    "endpoint": "http://localhost:11434/v1",
    "model": "gpt-oss:20b",
    "reasoning_effort": "low",
    "temperature": 0.9,
    "max_tokens": 1000,
    "timeout_s": 90,
    "api": "ollama",
    "keep_alive": "60m",
    "num_ctx": 32768,
}
CLASSIC_ORCHESTRATOR: dict[str, Any] = {
    "enabled": True,
    "survey_every_s": 120,
    "llm": {
        "model": "tobestyledintro/qwen3.8-9b-distill:q8_0",
        "temperature": 0.4,
        "max_tokens": 1200,
        "api": "ollama",
        "extra": {"think": False},
        "keep_alive": "60m",
    },
}


class HarnessError(RuntimeError):
    pass


def say(*parts: Any) -> None:
    print(*parts, flush=True)


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


# -- the Ollama lock + the rig ---------------------------------------------------------------


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


@contextmanager
def ollama_lock(path: Path = LOCK, wait_s: float = 4 * 3600, poll_s: float = 5.0, log: Callable[..., None] = say) -> Iterator[None]:
    """Hold the shared Ollama lock (mkdir is the atomic step; a pid file
    inside). A lock whose pid is gone is stale and taken over."""
    path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    told = False
    while True:
        try:
            path.mkdir()
            break
        except FileExistsError:
            pid_file = path / "pid"
            try:
                pid = int(pid_file.read_text().strip())
            except (OSError, ValueError):
                pid = None
            stale = (pid is not None and not _alive(pid)) or (pid is None and time.time() - path.stat().st_mtime > 120)
            if stale:
                log(f"replay: taking over a stale Ollama lock (pid {pid})")
                pid_file.unlink(missing_ok=True)
                try:
                    path.rmdir()
                except OSError:
                    pass
                continue
            if time.monotonic() - started > wait_s:
                raise HarnessError(f"the Ollama lock {path} is held (pid {pid}) — gave up after {wait_s:.0f} s") from None
            if not told:
                log(f"replay: waiting for the Ollama lock {path} (held by pid {pid})")
                told = True
            time.sleep(poll_s)
    (path / "pid").write_text(str(os.getpid()))
    try:
        yield
    finally:
        (path / "pid").unlink(missing_ok=True)
        try:
            path.rmdir()
        except OSError:
            pass


def rig_busy(minds_dir: Path, window_s: float = RIG_WINDOW_S, now: float | None = None) -> list[Path]:
    """The rig's traces that moved in the last `window_s` (the user's rig is
    live or rehearsing: wait)."""
    t = time.time() if now is None else now
    return [p for p in sorted(minds_dir.glob("*/Trabolta.trace.jsonl")) if t - p.stat().st_mtime < window_s]


def wait_for_rig(minds_dir: Path | None = None, poll_s: float = 60.0, max_wait_s: float = 4 * 3600, log: Callable[..., None] = say) -> None:
    minds_dir = minds_dir or main_checkout() / "stagehand" / ".stagehand-minds"
    started = time.monotonic()
    while True:
        busy = rig_busy(minds_dir)
        if not busy:
            return
        if time.monotonic() - started > max_wait_s:
            raise HarnessError(f"the rig stayed busy ({busy[0]}) — gave up")
        log(f"replay: the rig is live or rehearsing ({busy[0].parent.name} moved < 10 min ago) — waiting")
        time.sleep(poll_s)


# -- processes ----------------------------------------------------------------------------


def free_port(ports: range = PORTS) -> int:
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise HarnessError(f"no free port in {ports.start}–{ports.stop - 1}")


class Proc:
    """A child in its own process group, stopped by that group only."""

    def __init__(self, name: str, cmd: list[str], cwd: Path, env: dict[str, str], log_path: Path) -> None:
        self.name = name
        self.log_path = log_path
        self._log = log_path.open("ab")
        self.p = subprocess.Popen(cmd, cwd=str(cwd), env=env, stdout=self._log, stderr=subprocess.STDOUT, start_new_session=True)
        say(f"replay: started {name} (pid {self.p.pid})")

    @property
    def pid(self) -> int:
        return self.p.pid

    def alive(self) -> bool:
        return self.p.poll() is None

    def stop(self, grace_s: float = 15.0) -> None:
        if self.p.poll() is None:
            try:
                os.killpg(self.p.pid, signals.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.p.wait(grace_s)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(self.p.pid, signals.SIGKILL)
                except ProcessLookupError:
                    pass
                self.p.wait(5)
        else:
            # The leader exited; its group may still hold children (tsx, esbuild).
            try:
                os.killpg(self.p.pid, signals.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
        self._log.close()
        say(f"replay: stopped {self.name} (pid {self.p.pid})")

    def tail(self, n: int = 20) -> str:
        try:
            return "\n".join(self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-n:])
        except OSError:
            return ""


def server_env(port: int, state_dir: Path, worktree: Path = WORKTREE) -> dict[str, str]:
    show = worktree / "core" / "examples" / "trapped-in-the-internet"
    env = {k: v for k, v in os.environ.items() if not k.startswith(("LOOM_", "BETTER_AUTH", "DATABASE_URL"))}
    env.update(
        {
            "LOOM_DB_WAIT": "off",
            "DATABASE_URL": "postgres://nobody@127.0.0.1:1/none",
            "LOOM_WIKI": "off",
            "LOOM_STATE_DIR": str(state_dir),
            # Absolute: `pnpm --filter @loom/core serve` runs in core/.
            "LOOM_FACTS": str(show / "facts.json"),
            "LOOM_HOUSE": str(show / "house.json"),
            # The binding command says PORT; the server reads LOOM_PORT.
            "PORT": str(port),
            "LOOM_PORT": str(port),
            "LOOM_HOST": "127.0.0.1",
            "LOOM_EVENT_PASS": CODES["event"].format(port=port),
            "LOOM_MOD_PASS": CODES["mod"].format(port=port),
            "LOOM_PRIME_PASS": CODES["prime"].format(port=port),
        }
    )
    return env


def worker_env(port: int) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("LOOM_")}
    env.update({"LOOM_SERVER_URL": f"http://127.0.0.1:{port}", "LOOM_EVENT_ID": "default", "LOOM_MOD_PASSCODE": CODES["mod"].format(port=port)})
    return env


def worker_config(mode: str, *, port: int, state_dir: Path, persona: Path, name: str = "replay") -> dict[str, Any]:
    """The generated YAML (never laptop.yaml, never a show module)."""
    if mode not in ("classic", "new"):
        raise HarnessError("--mind is classic or new")
    agents: dict[str, Any] = {"name": name, "concurrency": 1, "llm": dict(HOUSE_LLM), "state_dir": str(state_dir), "characters": [str(persona)]}
    if mode == "classic":
        agents["orchestrator"] = json.loads(json.dumps(CLASSIC_ORCHESTRATOR))
    else:
        agents["mind_mode"] = "new"  # every voice.* / mind.* key at its default
    return {"server": {"url": f"http://127.0.0.1:{port}", "event": "default", "mod_passcode": CODES["mod"].format(port=port)}, "agents": agents}


def write_worker_yaml(path: Path, doc: dict[str, Any]) -> None:
    head = "# Generated by stagehand.replay for one scratch run — never laptop.yaml, never a show module.\n"
    path.write_text(head + yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")


# -- the console mirror -------------------------------------------------------------------------


def normal(m: dict[str, Any]) -> dict[str, Any]:
    """A chat message as the harness keeps it (`story` = it had a beat key)."""
    out = {
        "seq": m.get("seq"),
        "channel": m.get("channel"),
        "from": m.get("from"),
        "text": m.get("text", ""),
        "audience": list(m.get("audience") or []),
        "kind": m.get("kind", "line"),
        "ts": m.get("ts"),
        "story": "beat" in m,
        "via": m.get("via"),
        "hidden": bool(m.get("hidden")),
    }
    w = m.get("widget")
    if isinstance(w, dict):
        out["widget"] = str(w.get("kind", ""))
    return out


class Mirror:
    """One director console: the `history` + `message` frames of the mod
    SSE stream, and how many distinct mind copies its snapshots carried."""

    def __init__(self, base: str, token: str, character: str = CHARACTER) -> None:
        self.base = base
        self.token = token
        self.character = character
        self.messages: dict[int, dict[str, Any]] = {}
        self.cond = threading.Condition()
        #: When each message reached this console (monotonic), for wall times.
        self.arrived: dict[int, float] = {}
        #: The newest `typing` frame per thread: on = a request is open there.
        self.typing: dict[str, bool] = {}
        self.mind_ats: set[Any] = set()
        self.mind_bytes = 0
        self.online = False
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="replay-mirror", daemon=True)

    def start(self) -> "Mirror":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                with httpx.Client(timeout=httpx.Timeout(10.0, read=None)) as c:
                    with c.stream("GET", f"{self.base}/events", params={"role": "mod", "token": self.token}) as r:
                        buf = ""
                        for chunk in r.iter_text():
                            if self._stop.is_set():
                                return
                            buf += chunk
                            while "\n\n" in buf:
                                block, buf = buf.split("\n\n", 1)
                                self.frame(block)
            except Exception:  # noqa: BLE001 — reconnect
                if self._stop.wait(1.0):
                    return

    def frame(self, block: str) -> None:
        ev = ""
        data = []
        for line in block.split("\n"):
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                data.append(line[6:])
        if ev not in ("history", "message", "snapshot", "typing"):
            return
        try:
            doc = json.loads("\n".join(data))
        except json.JSONDecodeError:
            return
        now = time.monotonic()
        with self.cond:
            if ev == "history":
                for m in (doc.get("messages") if isinstance(doc, dict) else doc) or []:
                    if isinstance(m, dict) and isinstance(m.get("seq"), int):
                        self.messages[m["seq"]] = normal(m)
                        self.arrived.setdefault(m["seq"], now)
            elif ev == "message" and isinstance(doc, dict) and isinstance(doc.get("seq"), int):
                self.messages[doc["seq"]] = normal(doc)
                self.arrived.setdefault(doc["seq"], now)
            elif ev == "typing" and isinstance(doc, dict):
                self.typing[f"{doc.get('channel')}|{','.join(doc.get('audience') or [])}"] = bool(doc.get("on"))
            elif ev == "snapshot" and isinstance(doc, dict):
                for mind in doc.get("minds") or []:
                    if isinstance(mind, dict) and mind.get("character") == self.character:
                        self.mind_ats.add(mind.get("at"))
                        self.mind_bytes = max(self.mind_bytes, len(json.dumps(mind, ensure_ascii=False)))
                for c in doc.get("cast") or []:
                    if isinstance(c, dict) and c.get("id") == self.character:
                        self.online = bool(c.get("online"))
            self.cond.notify_all()

    def max_seq(self) -> int:
        with self.cond:
            return max(self.messages, default=0)

    def thread_state(self, threads: set[str], is_free: Callable[[dict[str, Any], list[dict[str, Any]]], bool]) -> dict[str, int | None]:
        """Per thread: the seq of his newest free reply when it came after
        the thread's last guest line and no request is open there (typing
        off), else None (still owed an answer)."""
        with self.cond:
            return thread_state([self.messages[k] for k in sorted(self.messages)], threads, self.typing, is_free)

    def snapshot(self) -> list[dict[str, Any]]:
        with self.cond:
            return [dict(self.messages[k]) for k in sorted(self.messages)]

    def wait(self, pred: Callable[[list[dict[str, Any]]], Any], deadline: float) -> Any:
        with self.cond:
            while True:
                got = pred([self.messages[k] for k in sorted(self.messages)])
                if got:
                    return got
                left = deadline - time.monotonic()
                if left <= 0:
                    return None
                self.cond.wait(min(left, 1.0))


def thread_state(msgs: list[dict[str, Any]], threads: set[str], typing: dict[str, bool], is_free: Callable[[dict[str, Any], list[dict[str, Any]]], bool]) -> dict[str, int | None]:
    out: dict[str, int | None] = {}
    for t in threads:
        last_line = newest = 0
        for m in msgs:
            if f"{m['channel']}|{','.join(m['audience'])}" != t:
                continue
            if m.get("from") != CHARACTER and m.get("kind", "line") == "line":
                last_line = max(last_line, int(m["seq"]))
            elif is_free(m, msgs):
                newest = max(newest, int(m["seq"]))
        out[t] = newest if newest > last_line and not typing.get(t, False) else None
    return out


# -- the driver -------------------------------------------------------------------------------------


@dataclass
class Guest:
    name: str
    id: str
    token: str
    pilot: str | None = None

    @property
    def speaking_token(self) -> str:
        return self.pilot or self.token

    @property
    def thread(self) -> str:
        return f"dm:{CHARACTER}|{self.id}"


@dataclass
class Driver:
    base: str
    port: int
    mirror: Mirror
    facts: Facts
    redactor: Redactor
    holds: tuple[str, ...]
    worktree: Path = WORKTREE
    guests: dict[str, Guest] = field(default_factory=dict)
    records: list[dict[str, Any]] = field(default_factory=list)
    bursts: list[dict[str, Any]] = field(default_factory=list)
    idle: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    phases: list[dict[str, Any]] = field(default_factory=list)
    mod: str = ""
    cursor: int = 0
    worker_alive: Callable[[], bool] = lambda: True
    http: httpx.Client | None = None
    #: Seconds of quiet before every top-level say after his reply (a guest's
    #: pace: the classic mind reflects in the gaps, the new one summarises).
    gap_s: float = 0.0

    def __post_init__(self) -> None:
        if self.http is None:
            self.http = httpx.Client(timeout=30.0)
        self.cues: list[dict[str, Any]] = [{"name": n} for n in chain_cues(self.worktree)] + [dict(c) for c in FINALE]
        self.self_pressed = self_pressed(self.worktree)

    # -- http
    def post(self, path: str, body: dict[str, Any], token: str | None = None) -> tuple[int, Any]:
        headers = {"x-loom-token": token} if token else {}
        r = self.http.post(f"{self.base}{path}", json=body, headers=headers)
        try:
            return r.status_code, r.json()
        except ValueError:
            return r.status_code, r.text

    def modpost(self, path: str, body: dict[str, Any]) -> tuple[int, Any]:
        return self.post(path, body, self.mod)

    def world(self) -> dict[str, Any]:
        r = self.http.get(f"{self.base}/api/state", params={"role": "mod", "token": self.mod})
        r.raise_for_status()
        return {w["path"]: w.get("value") for w in r.json().get("world", [])}

    def login(self) -> None:
        status, doc = self.post("/api/mod/login", {"passcode": CODES["mod"].format(port=self.port)})
        if status != 200:
            raise HarnessError(f"mod login → {status}")
        self.mod = doc["token"]

    # -- setup
    def register(self, name: str) -> Guest:
        body = {"name": name, "passcode": CODES["event"].format(port=self.port)}
        status, doc = self.post("/api/guest/register", body)
        if status == 409 and isinstance(doc, dict) and doc.get("error") == "reserved":
            self.modpost("/api/mod/claim/unlock", {"character": name})
            status, doc = self.post("/api/guest/register", body)
        if status != 200 or not isinstance(doc, dict) or "id" not in doc:
            raise HarnessError(f"register {name} → {status} {doc}")
        g = Guest(name=name, id=doc["id"], token=doc["token"])
        self.guests[name] = g
        return g

    def clear(self, g: Guest) -> None:
        self.modpost("/api/mod/signal", {"name": "captcha answered", "subject": g.id, "args": {"passed": False}})
        self.post("/api/guest/choose", {"index": 0}, g.token)
        self.post("/api/guest/choose", {"index": 0}, g.token)
        status, _ = self.modpost("/api/mod/scan", {"as": "Norton Anti-Virus", "target": g.id})
        if status != 200:
            self.errors.append(f"scan {g.name} → {status}")

    def setup(self, script: dict[str, Any]) -> None:
        self.modpost("/api/mod/start", {})
        for name in script.get("guests", []):
            g = self.register(name)
            if script.get("clear", True):
                self.clear(g)
        status, _ = self.post("/api/prime/login", {"character": "Clippy", "passcode": CODES["prime"].format(port=self.port)})
        if status != 200:
            self.errors.append(f"Clippy's booth → {status}")

    # -- the night
    def press(self, cue: dict[str, Any]) -> None:
        body: dict[str, Any] = {"name": cue["name"]}
        if cue.get("subject") == "$first" and self.guests:
            body["subject"] = next(iter(self.guests.values())).id
        if cue.get("actor"):
            body["actor"] = cue["actor"]
        status, doc = self.modpost("/api/mod/signal", body)
        refused = isinstance(doc, dict) and doc.get("refused") is True
        if status != 200 or (refused and cue["name"] not in self.self_pressed):
            raise HarnessError(f"the night stopped at {cue['name']} ({status} {doc}) — # hosts says why")

    def to_phase(self, target: str) -> None:
        here = self.world().get("Night.phase")
        while here != target:
            if self.cursor >= len(self.cues):
                raise HarnessError(f"no cue left to reach phase {target!r} (the night is at {here!r})")
            cue = self.cues[self.cursor]
            self.cursor += 1
            self.press(cue)
            time.sleep(0.4)
            here = self.world().get("Night.phase")
        self.phases.append({"phase": target, "at": time.time(), "cursor": self.cursor})
        say(f"replay: the night is at {target}")

    # -- lines
    def free(self, m: dict[str, Any], msgs: list[dict[str, Any]]) -> bool:
        stories = {x["text"] for x in msgs if x.get("from") == CHARACTER and x.get("story")}
        return scoring.is_free_reply(m, stories, self.holds)

    def send(self, step: dict[str, Any], burst: int | None = None) -> dict[str, Any]:
        g = self.guests[step["as"]]
        after = self.mirror.max_seq()
        text = resolve(step["say"], self.facts)
        status, doc = self.post("/api/guest/say", {"channel": f"dm:{CHARACTER}", "text": text}, g.speaking_token)
        rec = {
            "kind": "say",
            "as": g.name,
            "thread": g.thread,
            "text": self.redactor.redact(text),
            "offer": step.get("offer"),
            "piloted": g.pilot is not None,
            "status": status,
            "after": after,
            "sent_at": time.time(),
            "sent_mono": time.monotonic(),
            "reply": None,
            "reply_seq": None,
            "wall_ms": None,
            "timed_out": False,
            "burst": burst,
        }
        if status != 200:
            rec["error"] = str(doc)[:200]
            self.errors.append(f"say as {g.name} → {status} {str(doc)[:120]}")
        self.records.append(rec)
        say(f"  {g.name} → {CHARACTER}: {rec['text'][:90]}")
        return rec

    def await_reply(self, rec: dict[str, Any], deadline: float) -> None:
        if rec.get("status") != 200:
            return

        def pred(msgs: list[dict[str, Any]]) -> dict[str, Any] | None:
            for m in msgs:
                if m["seq"] > rec["after"] and f"{m['channel']}|{','.join(m['audience'])}" == rec["thread"] and self.free(m, msgs):
                    return m
            return None

        got = self.mirror.wait(pred, deadline)
        if got is None:
            rec["timed_out"] = True
            say(f"    (no reply to {rec['as']} in time)")
            return
        rec["reply"] = self.redactor.redact(got["text"])
        rec["reply_seq"] = got["seq"]
        rec["reply_at"] = time.time()
        rec["wall_ms"] = int((self.mirror.arrived.get(got["seq"], time.monotonic()) - rec["sent_mono"]) * 1000)
        say(f"    {CHARACTER} → {rec['as']} ({rec['wall_ms']} ms): {rec['reply'][:110]}")

    def last_say(self, name: str) -> dict[str, Any] | None:
        for rec in reversed(self.records):
            if rec.get("kind") == "say" and rec.get("as") == name:
                return rec
        return None

    def note(self, kind: str, **fields: Any) -> dict[str, Any]:
        rec = {"kind": kind, "at": time.time(), **fields}
        self.records.append(rec)
        return rec

    def file(self, step: dict[str, Any]) -> None:
        g = self.guests[step["as"]]
        cards = [m for m in self.mirror.snapshot() if m.get("kind") == "widget" and m.get("widget") == "fact" and g.id in m.get("audience", [])]
        if not cards:
            self.errors.append(f"{g.name} has no 📝 card to file on")
            self.note("file", q=step["file"], who=g.name, status=None)
            return
        answer = resolve(step["answer"], self.facts)
        status, _ = self.post("/api/guest/widget", {"seq": cards[-1]["seq"], "result": {"question": step["file"], "answer": answer, "confidence": int(step.get("confidence", 100))}}, g.speaking_token)
        self.note("file", q=step["file"], who=g.name, status=status, near="{near:" in step["answer"])
        say(f"  {g.name} files {step['file']} on the 📝 card → {status}")

    def step(self, s: dict[str, Any], burst: int | None = None) -> dict[str, Any] | None:
        kind = step_kind(s)
        if kind == "phase":
            self.to_phase(s["phase"])
        elif kind == "press":
            for _ in range(int(s["press"])):
                if self.cursor >= len(self.cues):
                    raise HarnessError("no cue left to press")
                self.press(self.cues[self.cursor])
                self.cursor += 1
                time.sleep(0.4)
        elif kind == "say":
            rec = self.send(s, burst)
            if s.get("wait", True) and burst is None:
                self.await_reply(rec, time.monotonic() + float(s.get("cap_s", REPLY_CAP_S)))
            return rec
        elif kind == "await":
            rec = self.last_say(s["await"])
            if rec is not None and rec["reply"] is None:
                self.await_reply(rec, rec["sent_mono"] + float(s.get("cap_s", REPLY_CAP_S)))
        elif kind == "unlock":
            g = self.guests[s["for"]]
            status, _ = self.modpost("/api/mod/codex", {"who": g.id, "entry": s["unlock"]})
            self.note("unlock", entry=s["unlock"], who=g.name, status=status)
        elif kind == "share":
            g = self.guests[s["as"]]
            status, doc = self.post("/api/guest/codex/share", {"entry": s["share"], "to": CHARACTER}, g.speaking_token)
            self.note("share", entry=s["share"], who=g.name, status=status)
            say(f"  📎 {g.name} shares {s['share']} → {status}")
        elif kind == "mark":
            g = self.guests[s["mark"]]
            status, _ = self.modpost("/api/mod/signal", {"name": "mark_for_reinstallation", "subject": g.id, "args": {"reason": s.get("reason", "")}})
            self.note("mark", who=g.name, status=status)
        elif kind == "pilot":
            g = self.guests[s["pilot"]]
            label = s.get("label", "Terminal · Server Room")
            status, doc = self.modpost("/api/mod/impersonate", {"role": "guest", "id": g.id, "label": label})
            if status != 200:
                raise HarnessError(f"impersonate {g.name} → {status} {doc}")
            g.pilot = doc["token"]
            self.modpost("/api/mod/signal", {"name": "terminal opened", "subject": g.id, "args": {"at": s.get("at", "The Server Room")}, "label": label})
            self.note("pilot", who=g.name)
        elif kind == "unpilot":
            g = self.guests[s["unpilot"]]
            label = s.get("label", "Terminal · Server Room")
            self.modpost("/api/mod/signal", {"name": "terminal closed", "subject": g.id, "args": {"at": s.get("at", "The Server Room")}, "label": label})
            g.pilot = None
            self.note("unpilot", who=g.name)
        elif kind == "signal":
            body: dict[str, Any] = {"name": s["signal"]}
            if s.get("subject"):
                body["subject"] = self.guests[s["subject"]].id
            for key in ("args", "label", "actor"):
                if key in s:
                    body[key] = s[key]
            status, _ = self.modpost("/api/mod/signal", body)
            self.note("signal", name=s["signal"], status=status)
        elif kind == "file":
            self.file(s)
        elif kind == "burst":
            self.burst(s)
        elif kind == "idle":
            self.rest(float(s["idle"]))
        elif kind == "sleep":
            time.sleep(float(s["sleep"]))
        return None

    def burst(self, s: dict[str, Any]) -> None:
        n = len(self.bursts)
        items = s["burst"]
        gap = float(s.get("within_s", 20)) / max(1, len(items) - 1)
        sent: list[dict[str, Any]] = []
        first = time.monotonic()
        for i, sub in enumerate(items):
            rec = self.step(sub, burst=n)
            if rec is not None:
                sent.append(rec)
            if i < len(items) - 1:
                time.sleep(gap)
        last = time.monotonic()
        deadline = last + float(s.get("cap_s", BURST_CAP_S))
        threads = {r["thread"] for r in sent if r.get("status") == 200}
        state = self.settle(threads, deadline)
        for rec in sent:
            self.await_reply(rec, time.monotonic() + 0.5)
        newest = [seq for seq in state.values() if seq is not None]
        end = max((self.mirror.arrived.get(seq, last) for seq in newest), default=time.monotonic())
        owed = sorted(t for t, seq in state.items() if seq is None)
        self.bursts.append({"id": n, "lines": len(sent), "threads": len(threads), "send_s": round(last - first, 1), "wall_s": round(end - first, 1), "unanswered": len(owed), "settled": not owed})
        if owed:
            self.errors.append(f"burst {n}: {len(owed)} thread(s) still owed an answer at the cap")
        say(f"replay: burst {n}: {len(sent)} lines in {len(threads)} threads, wall {end - first:.0f} s" + (f", {len(owed)} thread(s) unanswered" if owed else ""))

    def settle(self, threads: set[str], deadline: float, settle_s: float = BURST_SETTLE_S) -> dict[str, int | None]:
        """Wait until, in every thread, his newest free reply came after its
        last guest line and no request is open there, held for `settle_s`
        (or the deadline). Returns the per-thread state at the end."""
        held_since: float | None = None
        while True:
            state = self.mirror.thread_state(threads, self.free)
            now = time.monotonic()
            if all(v is not None for v in state.values()):
                held_since = now if held_since is None else held_since
                if now - held_since >= settle_s:
                    return state
            else:
                held_since = None
            if now >= deadline:
                return state
            with self.mirror.cond:
                self.mirror.cond.wait(min(0.25, max(0.0, deadline - now)))

    def rest(self, seconds: float) -> None:
        start = time.time()
        say(f"replay: leaving the house alone for {seconds:.0f} s")
        end_at = time.monotonic() + seconds
        while time.monotonic() < end_at:
            if not self.worker_alive():
                self.errors.append("the worker exited during the idle window")
                break
            time.sleep(min(10.0, max(0.0, end_at - time.monotonic())))
        self.idle.append({"start": start, "end": time.time()})

    def run(self, script: dict[str, Any]) -> None:
        said = False
        for s in script["steps"]:
            if "say" in s and said and self.gap_s > 0:
                time.sleep(self.gap_s)
            said = said or "say" in s
            self.step(s)


# -- writing a run ----------------------------------------------------------------------------------


def write_transcripts(run_dir: Path, history: list[dict[str, Any]], driver: Driver) -> None:
    out = run_dir / "transcripts"
    out.mkdir(parents=True, exist_ok=True)
    stories = scoring.story_texts(history)
    for g in driver.guests.values():
        lines = []
        for m in history:
            if m.get("channel") != f"dm:{CHARACTER}" or g.id not in (m.get("audience") or []):
                continue
            who = m.get("from")
            if m.get("kind") == "widget":
                lines.append(f"[{m['seq']}] (card: {m.get('widget', '?')})")
                continue
            tag = ""
            if who == CHARACTER:
                tag = " (story)" if (m.get("story") or m.get("text") in stories or m.get("text") in driver.holds) else (" (director)" if m.get("via") else "")
            lines.append(f"[{m['seq']}] {who}{tag}: {m.get('text', '')}")
        if lines:
            slug = "".join(ch if ch.isalnum() else "_" for ch in g.name)
            (out / f"{slug}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def report(run_dirs: list[Path], persona_file: Path | None = None) -> dict[str, Any]:
    runs = [scoring.load_run(d) for d in run_dirs]
    persona = load_show_persona(Path(runs[0].meta["persona"]) if persona_file is None and runs and runs[0].meta.get("persona") else persona_file)
    redactor = Redactor(persona.secrets)
    unsafe = scoring.is_unsafe_factory(persona.secrets, scoring_answer_words(persona.secrets))
    return scoring.score(runs, catchphrases(persona), unsafe, redactor.redact)


def live(mode: str, script_name: str, *, port: int | None = None, label: str | None = None, runs_root: Path = RUNS_ROOT, worktree: Path = WORKTREE, idle_s: float | None = None, gap_s: float = 0.0) -> Path:
    from .sources import load_script

    script = load_script(script_name)
    if idle_s is not None:
        for s in script["steps"]:
            if "idle" in s:
                s["idle"] = idle_s
    persona_file = persona_path(worktree)
    persona = load_show_persona(persona_file)
    facts = Facts.load(worktree / "core" / "examples" / "trapped-in-the-internet" / "facts.json")
    redactor = Redactor(persona.secrets)
    port = port or free_port()
    if port not in PORTS:
        raise HarnessError(f"port {port} is outside lane H's block {PORTS.start}–{PORTS.stop - 1}")
    script_id = str(script.get("name") or Path(script_name).stem)
    run_dir = runs_root / f"{utc_stamp()}-{label or script_id + '-' + mode}"
    (run_dir / "minds").mkdir(parents=True)
    state = run_dir / "state"
    state.mkdir()
    cfg_path = run_dir / f"agents.{mode}.yaml"
    write_worker_yaml(cfg_path, worker_config(mode, port=port, state_dir=run_dir / "minds", persona=persona_file))
    holds = hold_lines(worktree)
    meta: dict[str, Any] = {
        "version": 1,
        "script": script_id,
        "mode": mode,
        "label": label,
        "port": port,
        "character": CHARACTER,
        "persona": str(persona_file),
        "worktree": str(worktree),
        "match_digest": redactor.digest,
        "holds": [redactor.redact(h) for h in holds],
        "gap_s": gap_s,
        "started": time.time(),
    }
    say(f"replay: {meta['script']} on the {mode} mind → {run_dir}")
    server = worker = mirror = None
    driver: Driver | None = None
    with ollama_lock():
        wait_for_rig()
        try:
            server = Proc("scratch server", ["pnpm", "--filter", "@loom/core", "serve"], worktree, server_env(port, state, worktree), run_dir / "server.log")
            base = f"http://127.0.0.1:{port}/e/default"
            t0 = time.monotonic()
            while True:
                if not server.alive():
                    raise HarnessError(f"the scratch server exited:\n{server.tail()}")
                try:
                    if httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=2).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                if time.monotonic() - t0 > 120:
                    raise HarnessError("the scratch server never answered /api/health")
                time.sleep(1)
            mirror = Mirror(base, "")
            driver = Driver(base=base, port=port, mirror=mirror, facts=facts, redactor=redactor, holds=holds, worktree=worktree, gap_s=gap_s)
            driver.login()
            mirror.token = driver.mod
            mirror.start()
            driver.setup(script)
            worker = Proc("worker", ["uv", "run", "stagehand", "run", "--config", str(cfg_path), "--only", "agents"], worktree / "stagehand", worker_env(port), run_dir / "worker.log")
            driver.worker_alive = worker.alive
            t0 = time.monotonic()
            while not mirror.online:
                if not worker.alive():
                    hint = " (needs story-mind: this branch's config has no mind_mode)" if mode == "new" and "mind_mode" in worker.tail() else ""
                    raise HarnessError(f"the worker exited{hint}:\n{worker.tail()}")
                if time.monotonic() - t0 > 120:
                    raise HarnessError(f"the worker never came online:\n{worker.tail()}")
                time.sleep(1)
            say("replay: the worker is online")
            driver.run(script)
            time.sleep(3)
        finally:
            if worker is not None:
                worker.stop()
            if mirror is not None:
                mirror.stop()
            if server is not None:
                server.stop()
            if driver is not None:
                history = [redactor.deep(m) for m in mirror.snapshot()] if mirror is not None else []
                (run_dir / "history.json").write_text(json.dumps(history, ensure_ascii=False, indent=1), encoding="utf-8")
                write_transcripts(run_dir, history, driver)
                for rec in driver.records:
                    rec.pop("sent_mono", None)
                meta.update(
                    {
                        "ended": time.time(),
                        "records": driver.records,
                        "bursts": driver.bursts,
                        "idle": driver.idle,
                        "phases": driver.phases,
                        "errors": [redactor.redact(e) for e in driver.errors],
                        "guests": {g.name: g.id for g in driver.guests.values()},
                        "mirrors": {"distinct_copies": len(mirror.mind_ats) if mirror else 0, "max_bytes": mirror.mind_bytes if mirror else 0},
                    }
                )
            (run_dir / "run.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    rep = report([run_dir], persona_file)
    (run_dir / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    say(scoring.table(rep))
    return run_dir


# -- offline ------------------------------------------------------------------------------------


async def ollama_chat(messages: list[dict[str, str]], cfg: dict[str, Any] | None = None, transport: httpx.AsyncBaseTransport | None = None) -> tuple[str, dict[str, Any]]:
    """One native /api/chat call; returns (content, timings) — `prompt_ms`
    is Ollama's `prompt_eval_duration` in ms."""
    c = {**HOUSE_LLM, **(cfg or {})}
    base = c["endpoint"].rstrip("/")
    base = base[: -len("/v1")] if base.endswith("/v1") else base
    body = {
        "model": c["model"],
        "messages": messages,
        "stream": False,
        "keep_alive": c["keep_alive"],
        "options": {"temperature": c["temperature"], "num_predict": c["max_tokens"], "num_ctx": c["num_ctx"]},
        "think": c["reasoning_effort"],
    }
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=c["timeout_s"], transport=transport) as client:
        r = await client.post(f"{base}/api/chat", json=body)
    r.raise_for_status()
    doc = r.json()
    msg = doc.get("message") or {}
    content = msg.get("content") or ""
    if not content:
        from ..agents.llm import tool_calls_as_json

        content = tool_calls_as_json(msg)
    ped = doc.get("prompt_eval_duration")
    return content, {
        "ms": int((time.monotonic() - started) * 1000),
        "prompt_tokens": doc.get("prompt_eval_count"),
        "prompt_ms": round(ped / 1e6, 1) if isinstance(ped, (int, float)) else None,
        "eval_count": doc.get("eval_count"),
        "thinking": msg.get("thinking") or "",
        "finish": doc.get("done_reason") or "",
    }


def lean_voice() -> tuple[Any, Any]:
    """W1's lean voice and the frozen shapes, imported lazily."""
    try:
        from ..agents import cards, voice  # type: ignore[attr-defined]
    except ImportError as err:
        raise HarnessError(f"offline --mind new needs lean-voice (lane W1's stagehand.agents.voice): {err}") from err
    if not hasattr(voice, "answer_lean"):
        raise HarnessError("offline --mind new needs lean-voice: stagehand.agents.voice has no answer_lean")
    return voice, cards


def offline_classic_calls(trace: list[dict[str, Any]], limit: int | None = None) -> list[dict[str, Any]]:
    """The recorded voice prompts to re-send as they are (one per request)."""
    seen: set[str] = set()
    out = []
    for t in trace:
        if t.get("kind") != "voice" or t.get("trigger") not in ("line", "", None) or not t.get("messages"):
            continue
        rid = str(t.get("request_id") or t.get("id"))
        if rid in seen:
            continue
        seen.add(rid)
        out.append(t)
    return out[:limit] if limit else out


_GATE_EQ = re.compile(r"\bself\.([\w.]+)\s*==\s*(true|false|-?\d+(?:\.\d+)?|\"[^\"]*\"|'[^']*')")


def open_gate_vars(persona: Any) -> dict[str, Any]:
    """The `self.<var> == <value>` terms of the persona's `when:` gate, as
    the values that open it. Every recorded voice thought is a call that
    passed the gate (`module.answer` gates before any model call), so the
    replayed request must pass it too; the prompt's LIVE STATE does not show
    gate vars like `awake` (they are not the persona's `variables:`)."""
    when = getattr(persona, "when", None)
    src = getattr(when, "source", "") if when is not None else ""
    out: dict[str, Any] = {}
    for name, value in _GATE_EQ.findall(src or ""):
        out[name] = value.strip("\"'")
    return out


def lean_request(step: dict[str, Any], phase: str, history: list[dict[str, Any]], persona: Any = None) -> dict[str, Any]:
    """A request as the server builds one, from a line's `recorded_state`
    (self vars + ranges, the `Night.*` world, the speaker's vars) and the
    values that open the persona's gate."""
    gid = "g-" + "".join(ch for ch in step["as"].lower() if ch.isalnum())[:10]
    state = step.get("state") or {}
    world = {**(state.get("world") or {}), "Night.phase": phase}
    self_vars = {**(state.get("self") or {}), **open_gate_vars(persona)}
    them: dict[str, Any] = {"vars": dict(state.get("them") or {}), "codex": []}
    if state.get("location"):
        them["location"] = state["location"]
    return {
        "id": f"ar-offline-{len(history)}",
        "character": CHARACTER,
        "thread": {"character": CHARACTER, "channel": f"dm:{CHARACTER}", "audience": [gid]},
        "speaker": {"id": gid, "name": step["as"], "kind": "guest"},
        "text": step["say"],
        "history": list(history),
        "world": world,
        "self": {"vars": self_vars, "ranges": dict(state.get("ranges") or {}), "codex": []},
        "them": them,
        "powers": [],
        "recent": [],
    }


def gate_open(persona: Any, req: dict[str, Any]) -> bool:
    when = getattr(persona, "when", None)
    if when is None:
        return True
    from ..agents.prompt import gate_context

    return bool(when.evaluate(gate_context(req)))


def offline(mode: str, trace_path: Path, *, label: str | None = None, limit: int | None = None, runs_root: Path = RUNS_ROOT, chat: Callable[..., Any] = ollama_chat) -> Path:
    persona = load_show_persona()
    redactor = Redactor(persona.secrets)
    facts = Facts.load()
    trace = read_jsonl(trace_path)
    voice = cards = None
    if mode == "new":
        voice, cards = lean_voice()
    elif mode != "classic":
        raise HarnessError("--mind is classic or new")
    run_dir = runs_root / f"{utc_stamp()}-{label or 'offline-' + mode}"
    run_dir.mkdir(parents=True)
    records: list[dict[str, Any]] = []

    async def go() -> None:
        from ..agents.reply import parse_reply

        if mode == "classic":
            for t in offline_classic_calls(trace, limit):
                content, timing = await chat(t["messages"])
                say_ = parse_reply(content, persona.variables, persona.max_step).say
                records.append({"thread": f"{(t.get('thread') or {}).get('channel')}|{','.join((t.get('thread') or {}).get('audience') or [])}", "say": redactor.redact(say_), "calls": 1, **{k: v for k, v in timing.items() if k != "thinking"}})
                say(f"  {timing['ms']} ms, prompt {timing['prompt_tokens']} tok / {timing['prompt_ms']} ms: {records[-1]['say'][:90]}")
            return
        assert voice is not None and cards is not None
        from ..agents.llm import Completion, LlmConfig

        script = extract(trace, persona.secrets, facts, state=True)
        model = LlmConfig(**{k: v for k, v in HOUSE_LLM.items() if k in LlmConfig.__dataclass_fields__})
        phase = ""
        threads: dict[str, list[dict[str, Any]]] = {}
        said: list[tuple[str, str]] = []
        turns: dict[str, int] = {}
        n = 0
        for s in script["steps"]:
            if "phase" in s:
                phase = s["phase"]
                continue
            n += 1
            if limit and n > limit:
                break
            s = {**s, "say": resolve(s["say"], facts)}
            req = lean_request(s, phase, threads.get(s["as"], []), persona)
            gated = not gate_open(persona, req)
            if gated:
                say(f"  the persona's gate is shut for {s['as']}'s line: no model call (the score reads n/a)")
            key = s["as"]
            timings: list[dict[str, Any]] = []

            async def complete_fn(messages: list[dict[str, str]], cfg: Any, timings: list[dict[str, Any]] = timings) -> Any:
                content, timing = await chat(messages)
                timings.append(timing)
                extra = {"prompt_ms": timing["prompt_ms"]} if "prompt_ms" in Completion.__dataclass_fields__ else {}
                return Completion(content=content, thinking=timing["thinking"], finish=timing["finish"], prompt_tokens=timing["prompt_tokens"], completion_tokens=timing["eval_count"], ms=timing["ms"], **extra)

            ctx = cards.VoiceContext(
                phase=cards.PhaseView(phase=phase),
                person=cards.PersonCard(id=req["speaker"]["id"], name=key, turns=turns.get(key, 0)),
                said=cards.Said(to_them=tuple(t for k, t in said if k == key)[-3:], elsewhere=tuple(t for k, t in said if k != key)[-5:]),
            )
            reply = await voice.answer_lean(persona, model, req, ctx, complete_fn)
            history = threads.setdefault(key, [])
            history.append({"seq": len(history) + 1, "mine": False, "from": key, "text": s["say"]})
            history.append({"seq": len(history) + 1, "mine": True, "from": CHARACTER, "text": reply.say})
            said.append((key, reply.say))
            turns[key] = turns.get(key, 0) + 1
            records.append(
                {
                    "thread": f"dm:{CHARACTER}|{req['speaker']['id']}",
                    "say": redactor.redact(reply.say),
                    "calls": len(timings),
                    "gated": gated,
                    "ms": sum(t["ms"] for t in timings),
                    "prompt_tokens": timings[0]["prompt_tokens"] if timings else None,
                    "prompt_ms": timings[0]["prompt_ms"] if timings else None,
                }
            )
            say(f"  {records[-1]['ms']} ms ({len(timings)} call(s)): {records[-1]['say'][:90]}")

    with ollama_lock():
        wait_for_rig()
        asyncio.run(go())
    rep = scoring.score_offline(records, catchphrases(persona))
    meta = {"version": 1, "kind": "offline", "mode": mode, "trace": str(trace_path), "records": records, "report": rep}
    (run_dir / "offline.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (run_dir / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    say(scoring.table(rep))
    return run_dir


def main_error(err: Exception) -> int:
    print(f"replay: {err}", file=sys.stderr)
    return 2


__all__ = ["HarnessError", "ScriptError", "live", "offline", "report", "ollama_lock", "rig_busy", "worker_config", "Mirror", "Driver"]
