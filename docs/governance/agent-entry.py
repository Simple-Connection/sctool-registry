#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import json
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "docs" / "agent" / "index.yaml"


def load_index() -> dict:
    value = yaml.safe_load(INDEX.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("AGENT_INDEX_ROOT")
    return value


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-class", action="append", default=[])
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--format", choices=("json", "lines"), default="json")
    args = parser.parse_args()

    index = load_index()
    task_classes = index.get("task_classes", {})
    selected = list(args.task_class)

    for path in args.path:
        normalized = Path(path).as_posix().lstrip("./")
        matches = [
            task_class
            for task_class, entry in task_classes.items()
            if any(fnmatch.fnmatch(normalized, selector) for selector in entry.get("selectors", []))
        ]
        selected.extend(matches)

    selected = dedupe(selected)
    if not selected:
        selected = [index["default_task_class"]]

    unknown = [task_class for task_class in selected if task_class not in task_classes]
    if unknown:
        raise ValueError("UNKNOWN_TASK_CLASS:" + ",".join(unknown))

    entry_ids: list[str] = []
    routes: list[str] = []
    for task_class in selected:
        entry = task_classes[task_class]
        entry_ids.extend(entry.get("entries", []))
        routes.extend(entry.get("routes", []))

    entry_ids = dedupe(entry_ids)
    routes = dedupe(routes)
    entry_paths = [index["entries"][entry_id]["path"] for entry_id in entry_ids]
    read_set = dedupe(entry_paths + routes)

    result = {
        "task_classes": selected,
        "entries": entry_ids,
        "routes": routes,
        "read_set": read_set,
    }

    if args.format == "lines":
        for path in read_set:
            print(path)
    else:
        print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, TypeError, ValueError, OSError, yaml.YAMLError) as exc:
        print(f"ERROR AGENT_ENTRY:{exc}", file=sys.stderr)
        raise SystemExit(2)
