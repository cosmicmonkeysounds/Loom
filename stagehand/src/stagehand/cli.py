"""The `stagehand` command.

    stagehand run    --config laptop.yaml [--only agents]   run every enabled module
    stagehand check  --config laptop.yaml [--only agents]   validate + describe, exit
    stagehand modules                                        list the module kinds
    stagehand announce --config house.yaml [--no-chime] text…
                     play one announcement now (no story): with an `alexa:`
                     section through its device; else (wave 18b) through the
                     house speaker router — published on its MQTT announce
                     topic, so the `audio` job must be running.
    stagehand sounds stop [--announce] --config house.yaml
    stagehand sounds play <name> [--to T[,T…]] … --config house.yaml
                     the router by hand over MQTT (the LAN alone: the uplink
                     can be down): stop every house sound (+ the
                     announcements), or play one `sound X` (QLab's old GO).
    stagehand sounds placeholders --config house.yaml [--force] [--no-say] [--only a,b] [--out DIR]
                     write a labelled placeholder per story sound
                     (media/sounds.yaml) into the router's sounds_dir; never
                     touches a real file.
    stagehand lights test <fixture|look> [--color #rrggbb] [--brightness N] [--off] --config house.yaml
    stagehand lights pair [--seconds 120] --config house.yaml
    stagehand lights devices --config house.yaml
                     the house lights through the event server (the `lights`
                     job must be running to act): identify a fixture, play a
                     look or publish one state; open Zigbee pairing (0 closes
                     it); list Zigbee2MQTT's devices and the module's status.
    stagehand launchd install|uninstall|restart|status|print --job show|agents|audio|lights [--config f.yaml]
                     one launchd job per module on a Mac (see launchd.py)
    stagehand tasks install|uninstall|restart|stop|status|print --job show|agents|audio|lights [--config f.yaml]
                     the same on Windows (the house PC): one Task Scheduler
                     task per module, started at logon (see tasks.py)
    stagehand ask    --config laptop.yaml [--character Trabolta] [--name Ada] [--reflect] [text…]
                     talk to an agent persona straight through the model — no
                     server, no story; one line, or an interactive chat. With
                     --reflect the orchestrator runs after each exchange and the
                     evolving brief / dossier is printed, so the mind can be
                     tuned offline.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

from . import app
from .config import ConfigError, StagehandConfig, load_config, local_overlay_path, placeholders
from .launchd import JOBS
from .module import REGISTRY


def _describe(cfg: StagehandConfig) -> str:
    s = cfg.server
    lines = [f"server   : {s.url} (event: {s.event}, auth: {'token' if s.mod_token else 'passcode'})"]
    for module in cfg.modules.values():
        lines.append(f"[{module.name}]")
        lines.extend(module.describe())
    return "\n".join(lines)


def _only(value: str | None) -> list[str] | None:
    return None if not value else [v.strip() for v in value.split(",") if v.strip()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="stagehand", description="Loom live-event bridge")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("run", "run the enabled modules"), ("check", "validate a config and exit")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--config", required=True, help="path to the machine's stagehand YAML")
        p.add_argument("--only", help="comma list of modules to run from the config (default: all present)")
        p.add_argument("--log-file", help="also log to this file (UTF-8, rotated at 10 MB) — the Windows tasks' log")
    sub.add_parser("modules", help="list the available modules")
    ann = sub.add_parser("announce", help="play one announcement through the alexa: device now")
    ann.add_argument("--config", required=True)
    ann.add_argument("--no-chime", action="store_true", help="skip the chime")
    ann.add_argument("--voice", help="server voice (default: the section's voice)")
    ann.add_argument("--offline", action="store_true", help="don't ask the server — cache, then say")
    ann.add_argument("text", nargs="+")
    snd = sub.add_parser("sounds", help="the house speaker router by hand: stop, play, placeholders")
    snd.add_argument("action", choices=("stop", "play", "placeholders"))
    snd.add_argument("name", nargs="?", help="play: the story sound's name")
    snd.add_argument("--config", required=True)
    snd.add_argument("--announce", action="store_true", help="stop: also cut the announcement and empty the queue")
    # One value per --to (repeat it, or a comma list), so the name may come
    # before or after it: `sounds play --to living zip` never takes `zip` as a target.
    snd.add_argument("--to", action="append", default=[], metavar="TARGET", help="play: a zone / room / LOCATION / speaker, repeatable or a comma list (default: its audio.json cue)")
    snd.add_argument("--force", action="store_true", help="placeholders: rewrite existing placeholders (never a real file)")
    snd.add_argument("--no-say", action="store_true", help="placeholders: no spoken label (no `say`)")
    snd.add_argument("--only", help="placeholders: a comma list of names")
    snd.add_argument("--out", help="placeholders: write here instead of the router's sounds_dir")
    snd.add_argument("--manifest", help="placeholders: another manifest (default: media/sounds.yaml)")
    lt = sub.add_parser("lights", help="the house lights by hand, through the server: test, pair, devices")
    lt.add_argument("action", choices=("test", "pair", "devices"))
    lt.add_argument("name", nargs="?", help="test: a fixture id (identify) or a look name (play it)")
    lt.add_argument("--config", required=True)
    lt.add_argument("--color", help="test: publish this colour (#rrggbb) to the fixture")
    lt.add_argument("--brightness", type=int, help="test: publish this brightness (0–254, safety-clamped)")
    lt.add_argument("--off", action="store_true", help="test: publish OFF (a safety fixture stays at its floor)")
    lt.add_argument("--seconds", type=int, default=120, help="pair: how long joining stays open (0 closes it)")
    ld = sub.add_parser("launchd", help="install / restart a module as its own launchd job (macOS)")
    ld.add_argument("action", choices=("install", "uninstall", "restart", "status", "print"))
    ld.add_argument("--job", choices=JOBS, help="which module (status: default every job)")
    ld.add_argument("--config", help="the YAML the job runs (install / print)")
    ts = sub.add_parser("tasks", help="install / restart a module as its own Task Scheduler task (Windows)")
    ts.add_argument("action", choices=("install", "uninstall", "restart", "stop", "status", "print"))
    ts.add_argument("--job", choices=JOBS, help="which module (status: default every job)")
    ts.add_argument("--config", help="the YAML the job runs (install / print)")
    ask = sub.add_parser("ask", help="chat with an agent persona through the model (no server)")
    ask.add_argument("--config", required=True)
    ask.add_argument("--character", help="which persona (default: the only / first one)")
    ask.add_argument("--name", default="Guest", help="who you are, as the character sees it")
    ask.add_argument("--var", action="append", default=[], metavar="NAME=VALUE", help="a character variable (repeatable)")
    ask.add_argument("--reflect", action="store_true", help="run the orchestrator after each exchange and print the mind")
    ask.add_argument("--power", action="append", default=[], metavar="NAME", help="pretend the story declares this power (repeatable)")
    ask.add_argument("text", nargs="*", help="one line to send; omit for an interactive chat")
    args = parser.parse_args(argv)

    _logging(args.verbose, getattr(args, "log_file", None))
    if not args.verbose:
        logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per request is noise

    if args.command == "modules":
        for name, spec in REGISTRY.items():
            print(f"{name:<8} {spec.summary}")
        return 0

    if args.command == "launchd":
        return _launchd(args)
    if args.command == "tasks":
        return _tasks(args)

    try:
        only = {"ask": ["agents"], "announce": [_announcer(args.config)], "sounds": ["audio"], "lights": ["lights"]}.get(args.command) or _only(getattr(args, "only", None))
        cfg = load_config(args.config, only=only)
    except ConfigError as err:
        print(f"config error: {err}", file=sys.stderr)
        return 2

    if args.command == "ask":
        return _ask(cfg, args)
    if args.command == "announce":
        return _announce(cfg, args)
    if args.command == "sounds":
        return _sounds(cfg, args)
    if args.command == "lights":
        return _lights(cfg, args)

    print(_describe(cfg))
    todo = placeholders(cfg.server)
    if todo:
        print(
            f"PLACEHOLDER server.{', server.'.join(todo)} is still CHANGE-ME — put the real values in "
            f"{local_overlay_path(args.config).name} (git-ignored) or LOOM_EVENT_ID / LOOM_MOD_PASSCODE",
            file=sys.stderr,
        )
    if args.command == "check":
        # A module that checks against the server's config asks it first
        # (the audio router on a fresh house Mac, LA-5); never with placeholders.
        if not todo:
            for module in cfg.modules.values():
                if hasattr(module, "fetch_for_check"):
                    module.fetch_for_check(cfg.server)
        problems = [p for module in cfg.modules.values() for p in (module.preflight() if hasattr(module, "preflight") else [])]
        for problem in problems:
            print(f"check failed: {problem}", file=sys.stderr)
        for warning in (w for module in cfg.modules.values() for w in (module.warnings() if hasattr(module, "warnings") else [])):
            print(f"warning: {warning}", file=sys.stderr)
        if problems:
            return 3
        print("config OK")
        return 0
    try:
        asyncio.run(app.run(cfg, base_dir=str(Path(args.config).resolve().parent)))
    except KeyboardInterrupt:
        print("stagehand: stopped")
    return 0


def _logging(verbose: bool, log_file: str | None) -> None:
    """stderr, plus `--log-file` (a Windows task runs under pythonw.exe,
    which has no stderr at all: the file is then its only log)."""
    fmt = logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    handlers: list[logging.Handler] = []
    if sys.stderr is not None:
        handlers.append(logging.StreamHandler())
    if log_file:
        from logging.handlers import RotatingFileHandler

        Path(log_file).expanduser().parent.mkdir(parents=True, exist_ok=True)
        handlers.append(RotatingFileHandler(Path(log_file).expanduser(), maxBytes=10_000_000, backupCount=3, encoding="utf-8"))
    for h in handlers:
        h.setFormatter(fmt)
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO, handlers=handlers or [logging.NullHandler()])


def _job_hint(job: str) -> str:
    """How to see whether a job runs on this machine: launchd or Task Scheduler."""
    return f"`uv run stagehand {'tasks' if sys.platform == 'win32' else 'launchd'} status --job {job}`"


def _announcer(path: str) -> str:
    """Which section speaks a hand-fired announcement: `alexa:` while the
    YAML still has one, else the house speaker router (wave 18b)."""
    import yaml

    try:
        doc = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return "alexa"  # load_config reports the real error
    return "alexa" if isinstance(doc, dict) and "alexa" in doc else "audio"


#: `paho.mqtt.publish.single`, swapped in the tests.
def _publish_single(topic: str, payload: str, *, hostname: str, port: int, client_id: str, auth: dict | None) -> None:
    import paho.mqtt.publish as publish

    publish.single(topic, payload, qos=1, retain=False, hostname=hostname, port=port, client_id=client_id, auth=auth)


PUBLISH = _publish_single


#: The router's retained health topic (`online` / `offline` / `lost`).
ROUTER_HEALTH = "health/audio"


def _read_retained(topic: str, *, hostname: str, port: int, client_id: str, auth: dict | None, timeout: float = 1.5) -> str | None:
    """A topic's retained payload, or None when nothing is retained (or the
    broker is unreachable) within `timeout` s."""
    import threading

    import paho.mqtt.client as mqtt

    got: list[str] = []
    done = threading.Event()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    if auth:
        client.username_pw_set(auth["username"], auth.get("password"))

    def on_connect(c, _u, _f, rc, _p=None):
        if not getattr(rc, "is_failure", rc != 0):
            c.subscribe(topic, qos=1)
        else:
            done.set()

    def on_message(_c, _u, msg):
        if msg.retain:
            got.append(msg.payload.decode("utf-8", "replace"))
        done.set()

    client.on_connect, client.on_message = on_connect, on_message
    try:
        client.connect(hostname, port, keepalive=10)
    except OSError:
        return None
    client.loop_start()
    try:
        done.wait(timeout)
    finally:
        client.loop_stop()
        client.disconnect()
    return got[0] if got else None


#: `_read_retained`, swapped in the tests.
READ_RETAINED = _read_retained


def _to_router(router, topic: str, doc: dict) -> int:
    """One MQTT message to the router (never retained). → the exit code."""
    m = router.cfg.mqtt
    if m is None:
        print("the audio: section has no mqtt: broker — the router can only be reached through the server (Run → Stop house sounds)", file=sys.stderr)
        return 2
    auth = {"username": m.username, "password": m.password} if m.username else None
    try:
        PUBLISH(topic, json.dumps(doc), hostname=m.host, port=m.port, client_id=f"{m.client_id}-cli", auth=auth)
    except Exception as err:  # noqa: BLE001 — a refused socket, paho's own errors
        print(f"no broker at {m.host}:{m.port} ({err}) — is Mosquitto running on {'this PC' if sys.platform == 'win32' else 'this Mac'}?", file=sys.stderr)
        return 2
    # Nothing is retained on these topics: with no router listening the
    # message is gone, so say so rather than "sent".
    try:
        state = READ_RETAINED(ROUTER_HEALTH, hostname=m.host, port=m.port, client_id=f"{m.client_id}-cli-health", auth=auth)
    except Exception:  # noqa: BLE001 — the message went; the look is best effort
        state = None
    if state != "online":
        print(
            f"sent {topic}, but no router is listening ({ROUTER_HEALTH}: {state or 'nothing retained'}) — it played nothing. "
            f"Is the audio job running? {_job_hint('audio')}",
            file=sys.stderr,
        )
        return 1
    print(f"sent to the router: {topic} {json.dumps(doc)}")
    return 0


def _announce(cfg: StagehandConfig, args: argparse.Namespace) -> int:
    from .alexa.module import Alexa, Announcement
    from .modapi import ModClient

    if "alexa" not in cfg.modules:
        router = cfg.modules["audio"]
        if not router.cfg.announce:  # type: ignore[attr-defined]
            print("the audio: section has announce: false — the router does not speak announcements", file=sys.stderr)
            return 2
        text = " ".join(" ".join(args.text).split())
        return _to_router(router, router.cfg.announce_topic, {"text": text, "chime": not args.no_chime})  # type: ignore[attr-defined]

    alexa = cfg.modules["alexa"]
    assert isinstance(alexa, Alexa)
    print("\n".join(alexa.describe()))

    async def go() -> str:
        s = cfg.server
        # `engine: say` never asks the server, so it needs no link at all.
        mod = None if args.offline or alexa.cfg.engine != "server" else ModClient(s.url, event=s.event, token=s.mod_token, passcode=s.mod_passcode)
        try:
            a = Announcement(text=" ".join(" ".join(args.text).split()), voice=args.voice, chime=not args.no_chime)
            return await alexa.announcer(mod).announce(a)
        finally:
            if mod is not None:
                await mod.aclose()

    path = asyncio.run(go())
    print(f"played via {path}")
    return 0 if path != "failed" else 1


def _sounds(cfg: StagehandConfig, args: argparse.Namespace) -> int:
    router = cfg.modules["audio"]
    rc = router.cfg  # type: ignore[attr-defined]
    if args.action == "stop":
        return _to_router(router, rc.stop_topic, {"announce": True, "by": "cli"} if args.announce else {"by": "cli"})
    if args.action == "play":
        if not args.name:
            print("sounds play: which sound? (e.g. `sounds play zip --to living`)", file=sys.stderr)
            return 2
        to = [t.strip() for v in args.to for t in v.split(",") if t.strip()]
        return _to_router(router, rc.play_topic, {"name": args.name, **({"to": to} if to else {})})
    from .audio.placeholders import MANIFEST, generate, load_manifest

    try:
        manifest = load_manifest(args.manifest or MANIFEST)
    except (OSError, ValueError) as err:
        print(f"sounds placeholders: {err}", file=sys.stderr)
        return 2
    only = {n.strip() for n in (args.only or "").split(",") if n.strip()} or None
    unknown = sorted((only or set()) - set(manifest))
    if unknown:
        print(f"sounds placeholders: not in the manifest: {', '.join(unknown)}", file=sys.stderr)
        return 2
    out = Path(args.out).resolve() if args.out else Path(rc.sounds_dir)
    done = generate(out, manifest, say=not args.no_say, force=args.force, only=only)
    for name, action in done:
        print(f"{action:<5} {name}" + {"keep": " (a real file is there)", "skip": " (a placeholder is there; --force rewrites it)"}.get(action, ""))
    wrote = sum(1 for _, a in done if a == "wrote")
    print(f"{wrote} placeholder(s) written to {out}")
    return 0


def _lights_request(cfg: StagehandConfig, args: argparse.Namespace) -> tuple[str, str, dict] | str:
    """→ (method, path, body) for a `stagehand lights` action, or an error line."""
    if args.action == "devices":
        return ("GET", "/api/mod/lights", {})
    if args.action == "pair":
        if not 0 <= args.seconds <= 254:
            return "lights pair: --seconds is 0–254"
        return ("POST", "/api/mod/lights/pair", {"seconds": args.seconds})
    if not args.name:
        return "lights test: which fixture or look? (e.g. `lights test server-room-rgb --color #FF0000`)"
    state: dict = {}
    if args.off:
        state["state"] = "OFF"
    if args.color:
        state["color"] = args.color
    if args.brightness is not None:
        state["brightness"] = args.brightness
    if state:
        return ("POST", "/api/mod/lights/test", {"fixture": args.name, "set": state})
    from .lights.routing import is_look_name

    # A fixture id has a `-` or no `_`; a look name is snake_case. Ask the
    # server which it is only when both could fit: `heart` is tried as a look.
    key = "look" if is_look_name(args.name) and "-" not in args.name else "fixture"
    return ("POST", "/api/mod/lights/test", {key: args.name})


def _lights(cfg: StagehandConfig, args: argparse.Namespace) -> int:
    from .modapi import ModApiError, ModClient

    req = _lights_request(cfg, args)
    if isinstance(req, str):
        print(req, file=sys.stderr)
        return 2
    method, path, body = req
    s = cfg.server

    async def go() -> dict:
        mod = ModClient(s.url, event=s.event, token=s.mod_token, passcode=s.mod_passcode)
        try:
            return await (mod.get(path) if method == "GET" else mod.post(path, body))
        finally:
            await mod.aclose()

    try:
        answer = asyncio.run(go())
    except ModApiError as err:
        print(f"lights: {err}", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001 — httpx / OS errors: no server
        print(f"lights: the server didn't answer ({err})", file=sys.stderr)
        return 1
    print(_lights_report(args.action, answer))
    if args.action != "devices" and answer.get("module") is False:
        print("the server took it, but no lights module is listening — is the job running? " + _job_hint("lights"), file=sys.stderr)
        return 1
    return 0


def _lights_report(action: str, answer: dict) -> str:
    if action == "pair":
        return f"Zigbee pairing {'closed' if not answer.get('until') else 'open'} (seq {answer.get('seq')})"
    if action == "test":
        return f"sent (seq {answer.get('seq')})"
    module = answer.get("module")
    lines = [
        f"module   : {('online · ' if module.get('online') else 'OFFLINE · last seen ') + str(module.get('name') or '?')}" if isinstance(module, dict) else "module   : never polled this server",
        f"config   : {answer.get('version')} ({answer.get('source')}), {len((answer.get('lights') or {}).get('fixtures') or [])} fixture(s)",
    ]
    devices = answer.get("devices") or []
    placed = {f.get("device") for f in (answer.get("lights") or {}).get("fixtures") or [] if isinstance(f, dict)}
    lines.append(f"devices  : {len(devices)}" + ("" if answer.get("devicesAt") else " (Zigbee2MQTT never reported)"))
    for d in devices:
        caps = d.get("caps")
        what = "not a light" if caps is None else "+".join(k for k in ("color", "ct", "dim") if caps.get(k)) or "on/off"
        lines.append(f"  {'💡' if d.get('friendly') in placed else '  '} {d.get('friendly'):<24} {d.get('type'):<11} {what}" + (f"  ({d.get('vendor')} {d.get('model')})" if d.get("model") else ""))
    if answer.get("problems"):
        lines.append("problems : " + "; ".join(answer["problems"]))
    return "\n".join(lines)


def _launchd(args: argparse.Namespace) -> int:
    import plistlib

    from .launchd import Launchd

    if sys.platform == "win32" and args.action != "print":
        print("launchd is macOS only — on Windows use `uv run stagehand tasks " + args.action + (f" --job {args.job}" if args.job else "") + "` (Task Scheduler)", file=sys.stderr)
        return 2

    ld = Launchd(stagehand_dir=Path(__file__).resolve().parents[2])
    try:
        if args.action == "status":
            lines = ld.status([args.job] if args.job else JOBS)
        elif args.job is None:
            print(f"launchd {args.action}: needs --job {'|'.join(JOBS)}", file=sys.stderr)
            return 2
        elif args.action in ("install", "print"):
            if not args.config:
                print(f"launchd {args.action}: needs --config", file=sys.stderr)
                return 2
            if args.action == "print":
                print(plistlib.dumps(ld.render(args.job, args.config)).decode())
                return 0
            lines = ld.install(args.job, args.config)
        elif args.action == "restart":
            lines = ld.restart(args.job)
        else:
            lines = ld.uninstall(args.job)
    except ConfigError as err:
        print(f"launchd: {err}", file=sys.stderr)
        return 2
    print("\n".join(lines))
    return 0


def _tasks(args: argparse.Namespace, tasks=None) -> int:
    from .tasks import Tasks

    if sys.platform != "win32" and args.action != "print" and tasks is None:
        print("tasks is Windows only (Task Scheduler) — on a Mac use `uv run stagehand launchd " + args.action + "`; `tasks print` shows the XML anywhere", file=sys.stderr)
        return 2
    ts = tasks or Tasks(stagehand_dir=Path(__file__).resolve().parents[2])
    try:
        if args.action == "status":
            lines = ts.status([args.job] if args.job else JOBS)
        elif args.job is None:
            print(f"tasks {args.action}: needs --job {'|'.join(JOBS)}", file=sys.stderr)
            return 2
        elif args.action in ("install", "print"):
            if not args.config:
                print(f"tasks {args.action}: needs --config", file=sys.stderr)
                return 2
            if args.action == "print":
                print(ts.render(args.job, args.config))
                return 0
            lines = ts.install(args.job, args.config)
        elif args.action == "restart":
            lines = ts.restart(args.job)
        elif args.action == "stop":
            lines = ts.stop(args.job)
        else:
            lines = ts.uninstall(args.job)
    except ConfigError as err:
        print(f"tasks: {err}", file=sys.stderr)
        return 2
    print("\n".join(lines))
    return 0


def _ask(cfg: StagehandConfig, args: argparse.Namespace) -> int:
    from .agents.mind import Mind
    from .agents.module import Agents, answer, thread_key
    from .agents.orchestrator import parse_update, reflect_messages

    agents = cfg.modules["agents"]
    assert isinstance(agents, Agents)
    personas = agents.cfg.personas
    name = args.character or next(iter(personas))
    if name not in personas:
        print(f"no persona for {name!r} (have: {', '.join(personas)})", file=sys.stderr)
        return 2
    persona, model = personas[name], agents.cfg.models[name]
    orchestrator_model = agents.cfg.orchestrator_models[name]
    variables = {}
    for pair in args.var:
        key, _, value = pair.partition("=")
        variables[key.strip()] = value.strip()
    history: list[dict] = []
    mind = Mind(character=name, event="ask")
    mind.seed(persona.stages, persona.drives)
    powers = [{"id": p, "label": p, "description": None, "limit": None, "used": 0} for p in args.power]

    async def say(text: str) -> None:
        history.append({"seq": len(history) + 1, "mine": False, "from": args.name, "text": text})
        req = {
            "id": "ask",
            "character": name,
            "thread": {"character": name, "channel": f"dm:{name}", "audience": ["ask"]},
            "speaker": {"kind": "guest", "id": "ask", "name": args.name, "faction": None},
            "text": text,
            "history": history[-30:],
            "self": {"vars": variables, "ranges": {}, "codex": []},
            "them": {"vars": {}, "codex": [], "location": None},
            "world": {},
            "powers": powers,
        }
        reply = await answer(persona, model, req, gate=False, mind=mind if args.reflect else None)
        if reply.lookup:
            print(f"  (wanted to look up: {', '.join(reply.lookup)} — no session here)")
        print(f"{name}: {reply.say or '(silence)'}")
        if reply.adjust:
            print(f"  adjust {json.dumps(reply.adjust)}")
            for key, delta in reply.adjust.items():
                try:
                    variables[key] = str(float(variables.get(key, 0)) + delta)
                except ValueError:
                    pass
        if reply.acts:
            print(f"  act {json.dumps(list(reply.acts))}")
        if reply.say:
            history.append({"seq": len(history) + 1, "mine": True, "from": name, "text": reply.say})
        if not args.reflect:
            return
        mind.saw_exchange("ask", args.name, "guest", thread_key(req), len(history))
        from .agents.llm import complete

        completion = await complete(reflect_messages(persona, mind, req, reply, None, persona.summarize_after, thread_key(req)), orchestrator_model)
        raw = completion.content
        if completion.thinking:
            print("  [mind thinking] " + " ".join(completion.thinking.split())[:400])
        update = parse_update(raw)
        if update is None:
            print(f"  [mind] unusable orchestrator output: {raw[:200]!r}")
            return
        touched = mind.apply(update, speaker_id="ask", thread_key=thread_key(req), upto=len(history))
        print(f"  [mind] updated {', '.join(touched) or 'nothing'} ({completion.ms} ms)")
        if mind.stage:
            print(f"  [stage] {mind.stage}")
        if mind.brief:
            print("  [brief] " + " / ".join(mind.brief.splitlines()))
        if mind.mood:
            print(f"  [mood] {mind.mood}")
        if mind.drives:
            print("  [drives] " + ", ".join(f"{k} {v}" for k, v in mind.drives.items()))
        if mind.policy.get("favours") != "none":
            print(f"  [policy] {json.dumps(mind.policy)}")
        for n in mind.notes[-4:]:
            print(f"  [note] {n}")
        d = mind.people.get("ask")
        if d is not None and (d.summary or d.claims):
            print(f"  [you] trust {d.trust}: {d.summary}" + (f" | claims: {'; '.join(d.claims[-3:])}" if d.claims else ""))
        memo = mind.threads.get(thread_key(req))
        if memo is not None and memo.summary:
            print(f"  [thread] {memo.summary}")

    if args.text:
        asyncio.run(say(" ".join(args.text)))
        return 0
    print(f"talking to {name} via {model.model}" + (f"; mind via {orchestrator_model.model}" if args.reflect else "") + " — Ctrl+D to stop")
    try:
        while True:
            line = input(f"{args.name}> ").strip()
            if line:
                asyncio.run(say(line))
    except (EOFError, KeyboardInterrupt):
        print()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
