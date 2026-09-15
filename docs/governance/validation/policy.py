from __future__ import annotations

from .common import need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    index = ctx.policy_index
    scan_machine(index, ctx.policy_index_path, errors)

    need(index.get("document_type") == "policy_index", "POLICY_INDEX_TYPE", errors)
    need(index.get("active_root") == "docs/policy", "POLICY_ACTIVE_ROOT", errors)
    need(index.get("historical_index") == "docs/index.yaml", "POLICY_HISTORY_INDEX", errors)

    entry_policy = index.get("entry_policy", {})
    need(entry_policy.get("active") == "INDEX_ROUTED", "POLICY_ACTIVE_ENTRY", errors)
    need(entry_policy.get("historical") == "INDEX_ONLY", "POLICY_HISTORY_ENTRY", errors)
    need(entry_policy.get("expired") == "REMOVE", "POLICY_EXPIRED_ENTRY", errors)

    active_paths: set[str] = set()
    for policy_id, entry in index.get("active", {}).items():
        path = entry.get("path")
        need(isinstance(path, str), f"POLICY_PATH:{policy_id}", errors)
        if not isinstance(path, str):
            continue
        active_paths.add(path)
        need(path.startswith("docs/policy/"), f"POLICY_ACTIVE_LOCATION:{policy_id}:{path}", errors)
        need((ctx.root / path).is_file(), f"POLICY_ACTIVE_MISSING:{policy_id}:{path}", errors)
        need(
            entry.get("state") == "POLICY_DECIDED_IMPLEMENTATION_NOT_AUTHORIZED",
            f"POLICY_STATE:{policy_id}:{entry.get('state')}",
            errors,
        )

    historical_policy_paths: set[str] = set()
    for version, version_entry in ctx.index.get("versions", {}).items():
        version_history_paths: set[str] = set()
        for entry in version_entry.get("history", []):
            if entry.get("document_class") != "POLICY":
                continue
            path = entry.get("path")
            if not isinstance(path, str):
                continue
            historical_policy_paths.add(path)
            version_history_paths.add(path)
            expected_root = f"docs/ver{version}/history/"
            need(path.startswith(expected_root), f"POLICY_HISTORY_LOCATION:{version}:{path}", errors)
            need(entry.get("entry_mode") == "INDEX_ONLY", f"POLICY_HISTORY_MODE:{version}:{path}", errors)
            need((ctx.root / path).is_file(), f"POLICY_HISTORY_MISSING:{version}:{path}", errors)
        if version_history_paths:
            need(
                version_entry.get("history_root") == f"docs/ver{version}/history",
                f"POLICY_HISTORY_ROOT:{version}:{version_entry.get('history_root')}",
                errors,
            )

    for policy_id, entry in index.get("expired", {}).items():
        path = entry.get("path") if isinstance(entry, dict) else None
        need(path is None or not (ctx.root / path).exists(), f"POLICY_EXPIRED_PRESENT:{policy_id}:{path}", errors)

    discovered = {
        path.relative_to(ctx.root).as_posix()
        for path in (ctx.root / "docs").rglob("*_POLICY_*.md")
        if path.is_file()
    }
    expected = active_paths | historical_policy_paths
    for path in sorted(discovered - expected):
        errors.append(f"POLICY_UNINDEXED:{path}")
    for path in sorted(expected - discovered):
        errors.append(f"POLICY_INDEX_MISSING_FILE:{path}")

    root_policy_files = [
        path.relative_to(ctx.root).as_posix()
        for path in (ctx.root / "docs").glob("*_POLICY_*.md")
        if path.is_file()
    ]
    need(not root_policy_files, f"POLICY_ROOT_FILES:{','.join(root_policy_files)}", errors)
