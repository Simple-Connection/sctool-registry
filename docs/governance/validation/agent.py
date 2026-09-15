from __future__ import annotations

from pathlib import Path

from .common import need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    index = ctx.agent_index
    scan_machine(index, ctx.agent_index_path, errors)

    need(index.get("document_type") == "agent_entry_index", "AGENT_INDEX_TYPE", errors)
    need(index.get("entry_root") == "docs/agent/entries", "AGENT_ENTRY_ROOT", errors)
    need(index.get("resolver") == "docs/governance/agent-entry.py", "AGENT_RESOLVER", errors)
    need(index.get("history_default_entry") == "FORBIDDEN", "AGENT_HISTORY_DEFAULT", errors)

    entries = index.get("entries", {})
    task_classes = index.get("task_classes", {})
    need(index.get("default_task_class") in task_classes, "AGENT_DEFAULT_TASK_CLASS", errors)

    entry_paths: set[str] = set()
    for entry_id, entry in entries.items():
        path = entry.get("path")
        need(isinstance(path, str), f"AGENT_ENTRY_PATH:{entry_id}", errors)
        if not isinstance(path, str):
            continue
        entry_paths.add(path)
        need(path.startswith("docs/agent/entries/"), f"AGENT_ENTRY_LOCATION:{entry_id}:{path}", errors)
        need((ctx.root / path).is_file(), f"AGENT_ENTRY_MISSING:{entry_id}:{path}", errors)

    discovered = {
        path.relative_to(ctx.root).as_posix()
        for path in (ctx.root / "docs" / "agent" / "entries").glob("*.md")
        if path.is_file()
    }
    for path in sorted(discovered - entry_paths):
        errors.append(f"AGENT_ENTRY_UNINDEXED:{path}")
    for path in sorted(entry_paths - discovered):
        errors.append(f"AGENT_ENTRY_INDEX_MISSING_FILE:{path}")

    for task_class, route in task_classes.items():
        for entry_id in route.get("entries", []):
            need(entry_id in entries, f"AGENT_TASK_ENTRY:{task_class}:{entry_id}", errors)
        selectors = route.get("selectors", [])
        need(len(selectors) == len(set(selectors)), f"AGENT_SELECTOR_DUPLICATE:{task_class}", errors)
        for path in route.get("routes", []):
            need(isinstance(path, str), f"AGENT_TASK_ROUTE:{task_class}:{path}", errors)
            if isinstance(path, str):
                need((ctx.root / path).exists(), f"AGENT_TASK_ROUTE_MISSING:{task_class}:{path}", errors)

    need((ctx.root / index["resolver"]).is_file(), "AGENT_RESOLVER_MISSING", errors)
