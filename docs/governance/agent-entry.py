#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import json
from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "docs" / "agent" / "index.yaml"


def load_index() -> dict[str, Any]:
    value = yaml.safe_load(INDEX.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("AGENT_INDEX_ROOT")
    return value


def dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def merge_commands(target: dict[str, dict[str, Any]], source: dict[str, Any]) -> None:
    for command_id, definition in source.items():
        if command_id in target and target[command_id] != definition:
            raise ValueError(f"COMMAND_COLLISION:{command_id}")
        if isinstance(definition, dict):
            target[command_id] = definition


def resolve(index: dict[str, Any], selected: list[str]) -> dict[str, Any]:
    task_classes = index["task_classes"]
    unknown = [item for item in selected if item not in task_classes]
    if unknown:
        raise ValueError("UNKNOWN_TASK_CLASS:" + ",".join(unknown))

    intents: list[str] = []
    routes: list[str] = []
    constraints: list[str] = []
    forbidden: list[str] = []
    owned: list[str] = []
    excluded: list[str] = []
    authority_modes: list[str] = []
    commands: dict[str, dict[str, Any]] = {}
    machine: dict[str, Any] = {}
    conditional: dict[str, Any] = {}

    for task_class in selected:
        item = task_classes[task_class]
        intents.extend(item.get("intent_ids", []))
        routes.extend(item.get("routes", []))
        directives = item.get("directives", {})
        if directives.get("authority_mode"):
            authority_modes.append(str(directives["authority_mode"]))
        constraints.extend(directives.get("constraints", []))
        forbidden.extend(directives.get("forbidden", []))
        owned.extend(directives.get("owned_capabilities", []))
        excluded.extend(directives.get("excluded_capabilities", []))
        merge_commands(commands, directives.get("commands", {}))
        if isinstance(directives.get("machine"), dict):
            machine.update(directives["machine"])
        if isinstance(directives.get("conditional_task_classes"), dict):
            conditional.update(directives["conditional_task_classes"])

    return {
        "task_classes": selected,
        "intent_ids": dedupe(intents),
        "authority_modes": dedupe(authority_modes),
        "constraints": dedupe(constraints),
        "forbidden": dedupe(forbidden),
        "owned_capabilities": dedupe(owned),
        "excluded_capabilities": dedupe(excluded),
        "conditional_task_classes": conditional,
        "commands": commands,
        "machine": machine,
        "read_set": dedupe(routes),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-class", action="append", default=[])
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--catalog", action="store_true")
    parser.add_argument("--format", choices=("json", "lines"), default="json")
    args = parser.parse_args()

    index = load_index()
    task_classes = index["task_classes"]

    if args.catalog:
        print(json.dumps({
            key: {"intent_ids": value.get("intent_ids", []), "selector_count": len(value.get("selectors", []))}
            for key, value in task_classes.items()
        }, indent=2))
        return 0

    selected = list(args.task_class)
    for raw_path in args.path:
        path = Path(raw_path).as_posix().lstrip("./")
        selected.extend(
            key for key, value in task_classes.items()
            if any(fnmatch.fnmatch(path, pattern) for pattern in value.get("selectors", []))
        )

    selected = dedupe(selected)
    if not selected:
        selected = [index["default_task_class"]]

    result = resolve(index, selected)
    if args.format == "lines":
        print("\n".join(result["read_set"]))
    else:
        print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, TypeError, ValueError, OSError, yaml.YAMLError) as exc:
        print(f"ERROR AGENT_ENTRY:{exc}", file=sys.stderr)
        raise SystemExit(2)
