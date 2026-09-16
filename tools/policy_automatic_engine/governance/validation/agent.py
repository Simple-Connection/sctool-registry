from __future__ import annotations

from .common import need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    index = ctx.agent_index
    scan_machine(index, ctx.agent_index_path, errors)

    need(index.get("schema_version") == "2.0", "AGENT_INDEX_SCHEMA", errors)
    need(index.get("document_type") == "agent_entry_index", "AGENT_INDEX_TYPE", errors)
    need(index.get("resolver") == "tools/policy_automatic_engine/governance/agent-entry.py", "AGENT_RESOLVER", errors)
    need(index.get("history_default_entry") == "FORBIDDEN", "AGENT_HISTORY_DEFAULT", errors)
    need(index.get("direct_index_read") == "NOT_REQUIRED", "AGENT_DIRECT_INDEX_READ", errors)

    task_classes = index.get("task_classes", {})
    need(index.get("default_task_class") in task_classes, "AGENT_DEFAULT_TASK_CLASS", errors)

    for task_class, item in task_classes.items():
        need(isinstance(item.get("intent_ids"), list), f"AGENT_INTENTS:{task_class}", errors)
        routes = item.get("routes", [])
        selectors = item.get("selectors", [])
        directives = item.get("directives")
        need(isinstance(directives, dict), f"AGENT_DIRECTIVES:{task_class}", errors)
        need(len(routes) == len(set(routes)), f"AGENT_ROUTE_DUPLICATE:{task_class}", errors)
        need(len(selectors) == len(set(selectors)), f"AGENT_SELECTOR_DUPLICATE:{task_class}", errors)
        for path in routes:
            need(isinstance(path, str), f"AGENT_ROUTE_TYPE:{task_class}", errors)
            if isinstance(path, str):
                need((ctx.root / path).exists(), f"AGENT_ROUTE_MISSING:{task_class}:{path}", errors)

    entry_root = ctx.root / "docs" / "agent" / "entries"
    if entry_root.exists():
        residual = [p.relative_to(ctx.root).as_posix() for p in entry_root.rglob("*") if p.is_file()]
        need(not residual, f"AGENT_RESIDUAL_ENTRY_FILES:{','.join(sorted(residual))}", errors)

    need((ctx.root / index["resolver"]).is_file(), "AGENT_RESOLVER_MISSING", errors)
