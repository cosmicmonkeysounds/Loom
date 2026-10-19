"""`uv run python -m stagehand.replay <command>` (CONTRACTS.md §C7.1)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import drive, score as scoring
from .sources import Facts, ScriptError, check_script, extract, load_show_persona, read_jsonl


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m stagehand.replay", description="Wave 12's replay harness: scripts through today's mind and the new one, scored against the K-04 bars.")
    sub = parser.add_subparsers(dest="command", required=True)
    ex = sub.add_parser("extract", help="a recorded trace → a script of its guest lines (no replies, no prompts, no answers)")
    ex.add_argument("--trace", required=True, type=Path)
    ex.add_argument("--out", required=True, type=Path)
    ex.add_argument("--name", help="the script's name (default: the out file's stem)")
    lv = sub.add_parser("live", help="a scratch server + a scratch worker, the script driven, the run scored")
    lv.add_argument("--mind", required=True, choices=("classic", "new"))
    lv.add_argument("--script", required=True, help="a name under replay/scripts/ or a path")
    lv.add_argument("--port", type=int, help=f"default: the first free one in {drive.PORTS.start}–{drive.PORTS.stop - 1}")
    lv.add_argument("--label")
    lv.add_argument("--gap", type=float, default=drive.DEFAULT_GAP_S, help=f"seconds of quiet before each top-level guest line after his reply (default {drive.DEFAULT_GAP_S:.0f}: a guest's pace, so the classic mind reflects between lines; 0 = back to back, which cancels every classic reflect). Runs pooled by score should share one gap.")
    lv.add_argument("--idle", type=float, help="override every idle step's seconds (a short smoke run; bar 6 then reads n/a)")
    of = sub.add_parser("offline", help="re-send recorded prompts (classic) or build lean ones (new) against the real model, no server")
    of.add_argument("--trace", required=True, type=Path)
    of.add_argument("--mind", required=True, choices=("classic", "new"))
    of.add_argument("--limit", type=int, help="only the first N lines")
    of.add_argument("--label")
    sc = sub.add_parser("score", help="re-score finished runs (several = pooled, as K-04 reads them)")
    sc.add_argument("runs", nargs="+", type=Path)
    sc.add_argument("--persona", type=Path, help="default: the persona the first run used")
    sc.add_argument("--out", type=Path, help="write the pooled report here (one run: its report.json)")
    args = parser.parse_args(argv)
    try:
        if args.command == "extract":
            persona = load_show_persona()
            doc = extract(read_jsonl(args.trace), persona.secrets, Facts.load(), name=args.name or args.out.stem, source=args.trace.name)
            problems = check_script(doc, persona.secrets, Facts.load())
            if problems:
                raise ScriptError("the extracted script would leak: " + "; ".join(problems))
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            says = sum(1 for s in doc["steps"] if "say" in s)
            print(f"replay: {says} guest lines from {len(doc['guests'])} guests → {args.out}")
        elif args.command == "live":
            drive.live(args.mind, args.script, port=args.port, label=args.label, idle_s=args.idle, gap_s=args.gap)
        elif args.command == "offline":
            drive.offline(args.mind, args.trace, label=args.label, limit=args.limit)
        elif args.command == "score":
            rep = drive.report(args.runs, args.persona)
            out = args.out or (args.runs[0] / "report.json" if len(args.runs) == 1 else None)
            if out is not None:
                out.write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
            print(scoring.table(rep))
    except (drive.HarnessError, ScriptError) as err:
        print(f"replay: {err}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
