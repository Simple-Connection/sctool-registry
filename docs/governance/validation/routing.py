from __future__ import annotations

from .common import current_branch, need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    improvement_template_path = ctx.template_index["routes"]["improvement_plan"]["template"]
    essential_template_path = ctx.template_index["routes"]["session_document"]["essential"]["template"]

    machine_docs = {
        ctx.index_path: ctx.index,
        ctx.rules_index_path: ctx.rules_index,
        ctx.state_rules_path: ctx.state_rules,
        ctx.template_index_path: ctx.template_index,
        improvement_template_path: ctx.load(improvement_template_path),
        essential_template_path: ctx.load(essential_template_path),
        ctx.responsibility_index_path: ctx.responsibility_index,
        ctx.policy_index_path: ctx.policy_index,
        ctx.responsibility_index["routes"]["authorities"]: ctx.authorities,
        ctx.responsibility_index["routes"]["vocabulary"]: ctx.vocabulary,
        ctx.responsibility_index["routes"]["contracts"]: ctx.contracts,
        ctx.responsibility_index["routes"]["responsibilities"]: ctx.responsibilities,
        ctx.responsibility_index["routes"]["gates"]: ctx.gate_registry,
    }
    if ctx.plan is not None and ctx.plan_path is not None:
        machine_docs[ctx.plan_path] = ctx.plan
    for rel, doc in machine_docs.items():
        if doc.get("natural_language") == "FORBIDDEN":
            scan_machine(doc, rel, errors)

    index = ctx.index
    plan = ctx.plan
    if plan is None:
        current = index.get("current", {})
        need(current.get("state") == "IDLE", "INDEX_IDLE_STATE", errors)
        need(current.get("distribution_contract_version") is None, "INDEX_IDLE_VERSION", errors)
        need(current.get("branch") == "main", "INDEX_IDLE_BRANCH", errors)
        need(current.get("improvement_plan") is None, "INDEX_IDLE_PLAN", errors)
        need(current.get("current_session") is None, "INDEX_IDLE_SESSION", errors)
        need(current.get("current_session_document") is None, "INDEX_IDLE_SESSION_DOCUMENT", errors)
        need(current.get("next_session") is None, "INDEX_IDLE_NEXT_SESSION", errors)

        latest = index.get("latest_complete", {})
        latest_version = latest.get("distribution_contract_version")
        need(latest_version in index.get("versions", {}), f"INDEX_LATEST_VERSION:{latest_version}", errors)
        if latest_version in index.get("versions", {}):
            latest_entry = index["versions"][latest_version]
            need(
                latest_entry.get("state") == "HISTORICAL_COMPLETE",
                f"INDEX_LATEST_STATE:{latest_version}:{latest_entry.get('state')}",
                errors,
            )
            plan_route = latest_entry.get("improvement_plan", {}).get("path")
            need(latest.get("improvement_plan") == plan_route, "INDEX_LATEST_PLAN_ROUTE", errors)
        closeout_path = latest.get("closeout_evidence")
        need(
            isinstance(closeout_path, str) and (ctx.root / closeout_path).is_file(),
            f"INDEX_LATEST_CLOSEOUT:{closeout_path}",
            errors,
        )
    else:
        version = plan["version"]["distribution_contract_version"]

        need(
            index["current"]["distribution_contract_version"] == version,
            "INDEX_PLAN_VERSION",
            errors,
        )
        need(
            index["current"]["branch"] == plan["version"]["branch"],
            "INDEX_PLAN_BRANCH",
            errors,
        )
        need(
            index["current"]["state"] == plan["version"]["state"],
            "INDEX_PLAN_STATE",
            errors,
        )
        need(
            index["versions"][version]["state"] == plan["version"]["state"],
            "VERSION_PLAN_STATE",
            errors,
        )
        need(
            index["current"]["improvement_plan"] == ctx.plan_path,
            "INDEX_PLAN_ROUTE",
            errors,
        )
        need(
            index["template_index"] == ctx.template_index_path,
            "INDEX_TEMPLATE_ROUTE",
            errors,
        )
        need(
            index["rules_index"] == ctx.rules_index_path,
            "INDEX_RULES_ROUTE",
            errors,
        )
        need(
            index["responsibility_index"] == ctx.responsibility_index_path,
            "INDEX_RESPONSIBILITY_ROUTE",
            errors,
        )

        plan_routing = plan["routing"]
        need(
            plan_routing["docs_index"] == ctx.index_path,
            "PLAN_DOCS_INDEX_ROUTE",
            errors,
        )
        need(
            plan_routing["rules_index"] == ctx.rules_index_path,
            "PLAN_RULES_ROUTE",
            errors,
        )
        need(
            plan_routing["template_index"] == ctx.template_index_path,
            "PLAN_TEMPLATE_ROUTE",
            errors,
        )
        need(
            plan_routing["responsibility_index"] == ctx.responsibility_index_path,
            "PLAN_RESPONSIBILITY_ROUTE",
            errors,
        )

        version_entry = index["versions"][version]
        need(
            version_entry["improvement_plan"]["path"] == ctx.plan_path,
            "VERSION_PLAN_ROUTE",
            errors,
        )
        need(
            version_entry["session_document_root"] == plan_routing["session_document_root"],
            "VERSION_SESSION_ROOT",
            errors,
        )

        migration_ids = ctx.rules_index["migration_ids"]
        current_migrations = index["current"].get("migrations", {})
        version_migrations = version_entry.get("migrations", {})
        plan_migrations = plan.get("migrations", {})
        for migration_id in migration_ids:
            need(migration_id in current_migrations, f"CURRENT_MIGRATION_MISSING:{migration_id}", errors)
            need(migration_id in version_migrations, f"VERSION_MIGRATION_MISSING:{migration_id}", errors)
            need(migration_id in plan_migrations, f"PLAN_MIGRATION_MISSING:{migration_id}", errors)
            need(
                current_migrations.get(migration_id) == plan_migrations.get(migration_id),
                f"CURRENT_MIGRATION_STATE:{migration_id}",
                errors,
            )
            need(
                version_migrations.get(migration_id) == plan_migrations.get(migration_id),
                f"VERSION_MIGRATION_STATE:{migration_id}",
                errors,
            )


    need(
        index["template_index"] == ctx.template_index_path,
        "INDEX_TEMPLATE_ROUTE",
        errors,
    )
    need(
        index["rules_index"] == ctx.rules_index_path,
        "INDEX_RULES_ROUTE",
        errors,
    )
    need(
        index["responsibility_index"] == ctx.responsibility_index_path,
        "INDEX_RESPONSIBILITY_ROUTE",
        errors,
    )
    need(
        index["policy_index"] == ctx.policy_index_path,
        "INDEX_POLICY_ROUTE",
        errors,
    )

    need(index.get("history_entry_policy") == "INDEX_ONLY", "HISTORY_ENTRY_POLICY", errors)
    need(index.get("expired_document_policy") == "REMOVE", "EXPIRED_DOCUMENT_POLICY", errors)

    for version_id, version_entry in index.get("versions", {}).items():
        history = version_entry.get("history", [])
        if history:
            expected_history_root = f"docs/ver{version_id}/history"
            need(
                version_entry.get("history_root") == expected_history_root,
                f"HISTORY_ROOT:{version_id}:{version_entry.get('history_root')}",
                errors,
            )
        for entry in history:
            path = entry.get("path")
            need(
                isinstance(path, str) and path.startswith(f"docs/ver{version_id}/history/"),
                f"HISTORY_PATH:{version_id}:{path}",
                errors,
            )
            need(entry.get("entry_mode") == "INDEX_ONLY", f"HISTORY_ENTRY_MODE:{version_id}:{path}", errors)
            if isinstance(path, str):
                need((ctx.root / path).is_file(), f"HISTORY_FILE_MISSING:{version_id}:{path}", errors)

    for entry in index.get("expired_documents", []):
        path = entry.get("path") if isinstance(entry, dict) else entry
        need(
            isinstance(path, str) and not (ctx.root / path).exists(),
            f"EXPIRED_DOCUMENT_PRESENT:{path}",
            errors,
        )

    template_index = ctx.template_index
    need(
        template_index["rules_index"] == ctx.rules_index_path,
        "TEMPLATE_RULES_ROUTE",
        errors,
    )
    need(
        template_index["responsibility_index"] == ctx.responsibility_index_path,
        "TEMPLATE_RESPONSIBILITY_ROUTE",
        errors,
    )
    need(
        index["templates"]["improvement_plan"] == improvement_template_path,
        "INDEX_IMPROVEMENT_TEMPLATE_ROUTE",
        errors,
    )
    need(
        index["templates"]["session_essential"] == essential_template_path,
        "INDEX_ESSENTIAL_TEMPLATE_ROUTE",
        errors,
    )

    for session_type, route in template_index["routes"]["session_document"]["types"].items():
        type_path = route["template"]
        type_doc = ctx.load(type_path)
        if type_doc.get("natural_language") in {"FORBIDDEN", "REFERENCE_ONLY"}:
            scan_machine(type_doc, type_path, errors)
        need(type_doc["session_type"] == session_type, f"TEMPLATE_TYPE:{session_type}", errors)
        need(
            index["templates"]["session_types"][session_type] == type_path,
            f"INDEX_TYPE_TEMPLATE_ROUTE:{session_type}",
            errors,
        )

    layout = ctx.rules_index.get("layout", {})
    need(
        ctx.index_path == layout.get("docs_index"),
        f"DOCS_INDEX_LAYOUT:{ctx.index_path}",
        errors,
    )

    route_roots = (
        ("RULES", ctx.rules_index_path, layout.get("rules_root")),
        ("TEMPLATE", ctx.template_index_path, layout.get("template_root")),
        ("RESPONSIBILITY", ctx.responsibility_index_path, layout.get("responsibility_root")),
        ("POLICY", ctx.policy_index_path, layout.get("policy_root")),
    )
    for route_name, route_path, root_path in route_roots:
        need(
            isinstance(root_path, str)
            and (route_path == root_path or route_path.startswith(root_path.rstrip("/") + "/")),
            f"FLAT_ROUTE_ROOT:{route_name}:{route_path}:{root_path}",
            errors,
        )

    if plan is not None:
        version_root_pattern = layout.get("version_root_pattern")
        version_root = (
            version_root_pattern.replace("{version}", version)
            if isinstance(version_root_pattern, str)
            else None
        )
        need(
            isinstance(version_root, str)
            and (ctx.plan_path == version_root or ctx.plan_path.startswith(version_root.rstrip("/") + "/")),
            f"VERSION_PLAN_ROOT:{ctx.plan_path}:{version_root}",
            errors,
        )
        need(
            isinstance(version_root, str)
            and (
                plan_routing["session_document_root"] == version_root
                or plan_routing["session_document_root"].startswith(version_root.rstrip("/") + "/")
            ),
            f"VERSION_SESSION_ROOT_LAYOUT:{plan_routing['session_document_root']}:{version_root}",
            errors,
        )

    responsibility_root = layout.get("responsibility_root")
    if isinstance(responsibility_root, str):
        responsibility_prefix = responsibility_root.rstrip("/") + "/"
        for route_name, route_path in ctx.responsibility_index["routes"].items():
            need(
                route_path.startswith(responsibility_prefix),
                f"RESPONSIBILITY_ROUTE_ROOT:{route_name}:{route_path}",
                errors,
            )

    template_root = layout.get("template_root")
    need(
        ctx.template_index.get("template_root") == template_root,
        f"TEMPLATE_ROOT:{ctx.template_index.get('template_root')}:{template_root}",
        errors,
    )

    for forbidden_path in layout.get("forbidden_paths", []):
        need(
            not (ctx.root / forbidden_path).exists(),
            f"NESTED_GOVERNANCE_PATH:{forbidden_path}",
            errors,
        )

    tooling = ctx.rules_index.get("tooling", {})
    tooling_root = layout.get("tooling_root")
    tooling_prefix = (
        tooling_root.rstrip("/") + "/"
        if isinstance(tooling_root, str)
        else None
    )
    for tooling_key in ("entrypoint", "requirements", "package_root"):
        tooling_path = tooling.get(tooling_key)
        need(
            isinstance(tooling_path, str) and (ctx.root / tooling_path).exists(),
            f"GOVERNANCE_TOOLING_PATH:{tooling_key}:{tooling_path}",
            errors,
        )
        need(
            isinstance(tooling_path, str)
            and isinstance(tooling_root, str)
            and (tooling_path == tooling_root or tooling_path.startswith(tooling_prefix)),
            f"GOVERNANCE_TOOLING_ROOT:{tooling_key}:{tooling_path}:{tooling_root}",
            errors,
        )

    branch = current_branch(ctx.root)
    if branch:
        if plan is None:
            need(branch == "main", f"GIT_BRANCH_IDLE:{branch}:main", errors)
        else:
            need(branch == plan["version"]["branch"], f"GIT_BRANCH:{branch}:{plan['version']['branch']}", errors)
