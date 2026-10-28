"""`stagehand sounds library` (wave 38, C6): render the SFX library to WAVs.

    uv run stagehand sounds library --config trapped.house.yaml [--out DIR] [--only a,b] [--list] [--story]

- Writes every sound (or `--only` these) to `<out>/<category>/<name>.wav`;
  `--out` defaults to `stagehand/media/library/` (git-ignored). A file that
  already holds the same bytes is left alone (`same`), so a re-run touches
  nothing.
- `--list` prints name, category, length, loop / one-shot and note, and
  writes nothing.
- `--story` also puts each story sound that has a library stand-in (the
  manifest's `library:` key, `media/sounds.yaml`) into the router's
  `sounds_dir` as `<story name>.wav`. It replaces only a generated
  placeholder or an older loom-sfx file; when any file of that name
  (.wav / .aiff / .aif / .flac) is something else — a real asset someone
  dropped in — it keeps it (`keep`), always.

`stagehand/cli.py` parses the arguments and loads the config (for
`sounds_dir`); everything else is here, as plain functions the tests call.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

from ..placeholders import MANIFEST, load_manifest
from ..sounds import EXTENSIONS, is_placeholder
from . import render as R
from .registry import SFX, Spec

#: The library's default home: stagehand/media/library/ (beside sounds.yaml).
LIBRARY_DIR = MANIFEST.parent / "library"


@dataclass(frozen=True)
class Written:
    spec: Spec
    path: Path
    action: str  # wrote | same | keep (story only: a real file is there)
    story: str | None = None


def select(only: str | None) -> list[Spec]:
    """The named sounds (a comma list, in the library's order), or all of
    them. Raises KeyError naming the unknown ones."""
    names = {n.strip() for n in (only or "").split(",") if n.strip()}
    unknown = sorted(names - set(SFX))
    if unknown:
        raise KeyError(", ".join(unknown))
    return [s for n, s in SFX.items() if not names or n in names]


def story_map(manifest_path: str | Path = MANIFEST) -> dict[str, str]:
    """story sound → library sound, from the manifest's `library:` keys."""
    return {name: spec.library for name, spec in load_manifest(manifest_path).items() if spec.library}


def install_story(sounds_dir: str | Path, story: str, data: bytes) -> tuple[Path, str]:
    """Put a library sound's WAV bytes in `sounds_dir` as `<story>.wav`.
    → (path, `wrote` | `same` | `keep`). Never replaces a real file: any file
    of that name (any extension, any case) that is neither a placeholder nor
    a loom-sfx file means `keep`."""
    d = Path(sounds_dir)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / f"{story}.wav"
    same_name = [p for p in d.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS and p.stem.lower() == story.lower()]
    if any(not is_placeholder(p) and not R.is_sfx(p) for p in same_name):
        return dest, "keep"
    # a differently-cased `<Story>.wav` placeholder is replaced, not doubled
    for p in same_name:
        if p.suffix.lower() == ".wav" and p.name != dest.name:
            p.unlink()
    return dest, R.write_bytes(dest, data)


def build(
    specs: list[Spec],
    out_dir: str | Path,
    *,
    story_dir: str | Path | None = None,
    stories: dict[str, str] | None = None,
) -> list[Written]:
    """Render `specs` into the library at `out_dir`; with `story_dir`, also
    install each one a story sound names (`stories`: story → library name)."""
    by_library: dict[str, list[str]] = {}
    for story, lib in (stories or {}).items():
        by_library.setdefault(lib, []).append(story)
    done: list[Written] = []
    for spec in specs:
        data = R.wav_bytes(spec, R.render(spec))
        path = R.library_path(out_dir, spec)
        done.append(Written(spec, path, R.write_bytes(path, data)))
        if story_dir is not None:
            for story in by_library.get(spec.name, []):
                dest, action = install_story(story_dir, story, data)
                done.append(Written(spec, dest, action, story))
    return done


def run(args: argparse.Namespace, sounds_dir: str | Path) -> int:
    """The `sounds library` action (args: out, only, list, story, manifest)."""
    try:
        specs = select(args.only)
    except KeyError as err:
        print(f"sounds library: not in the library: {err.args[0]}", file=sys.stderr)
        return 2
    if args.list:
        for spec in specs:
            print(R.describe(spec))
        print(f"{len(specs)} sound(s)")
        return 0
    stories: dict[str, str] = {}
    if args.story:
        try:
            stories = story_map(getattr(args, "manifest", None) or MANIFEST)
        except (OSError, ValueError) as err:
            print(f"sounds library: {err}", file=sys.stderr)
            return 2
        for story, lib in sorted(stories.items()):
            if lib not in SFX:
                print(f"sounds library: {story} names library sound {lib!r}, which does not exist yet; skipped", file=sys.stderr)
    out = Path(args.out).resolve() if args.out else LIBRARY_DIR
    try:
        done = build(specs, out, story_dir=Path(sounds_dir) if args.story else None, stories=stories)
    except R.RenderError as err:
        print(f"sounds library: {err}", file=sys.stderr)
        return 1
    for w in done:
        if w.story is None:
            print(f"{w.action:<5} {w.spec.category}/{w.path.name}")
        else:
            why = " (a real file is there)" if w.action == "keep" else ""
            print(f"{w.action:<5} story {w.story} ← {w.spec.name} → {w.path}{why}")
    wrote = sum(1 for w in done if w.story is None and w.action == "wrote")
    print(f"{wrote} of {len(specs)} library sound(s) written to {out}")
    if args.story:
        installed = sum(1 for w in done if w.story and w.action == "wrote")
        print(f"{installed} story sound(s) written to {sounds_dir}")
    return 0
