from __future__ import annotations

from .common import current_branch, need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    improvement_template_path = ctx.template_index["routes"]["improvement_plan"]["template"]
    essential_template_path = ctx.template_index["routes"]["session_document"]["essential"]["template"]

    machine_docs = {
        ctx.index_path: ctx.index,
        ctx.plan_path: ctx.plan,
        ctx.rules_index_path: ctx.rules_index,
        ctx.state_rules_path: ctx.state_rules,
        ctx.template_index_path: ctx.template_index,
        improvement_template_path: ctx.load(improvement_template_path),
        essential_template_path: ctx.load(essential_template_path),
        ctx.responsibility_index_path: ctx.responsibility_index,
        ctx.responsibility_index["routes"]["authorities"]: ctx.authorities,
        ctx.responsibility_index["routes"]["vocabulary"]: ctx.vocabulary,
        ctx.responsibility_index["routes"]["contracts"]: ctx.contracts,
        ctx.responsibility_index["routes"]["responsibilities"]: ctx.responsibilities,
        ctx.responsibility_index["routes"]["gates"]: ctx.gate_registry,
    }
    for rel, doc in machine_docs.items():
        if doc.get("natural_language") == "FORBIDDEN":
            scan_machine(doc, rel, errors)

    index = ctx.index
    plan = ctx.plan
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
    )
    for route_name, route_path, root_path in route_roots:
        need(
            isinstance(root_path, str)
            and (route_path == root_path or route_path.startswith(root_path.rstrip("/") + "/")),
            f"FLAT_ROUTE_ROOT:{route_name}:{route_path}:{root_path}",
            errors,
        )

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
        need(branch == plan["version"]["branch"], f"GIT_BRANCH:{branch}:{plan['version']['branch']}", errors)
