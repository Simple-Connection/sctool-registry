from __future__ import annotations

from .common import need, scan_machine
from .context import ValidationContext
from .task_contract import validate_bound_task


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    plan_sessions = {entry["id"]: entry for entry in ctx.plan.get("sessions", [])}
    index_next = ctx.index.get("current", {}).get("next_session", {})
    gate_ids = set(ctx.gate_registry.get("gates", {}))
    authority_ids = set(ctx.authorities.get("authorities", {}))
    responsibilities = ctx.responsibilities.get("responsibilities", {})

    for session_id, session in plan_sessions.items():
        planning_path = session.get("planning_document")
        planning_state = session.get("planning_state")
        if planning_path is None:
            need(
                planning_state in (None, "NONE"),
                f"PLANNING_STATE_WITHOUT_DOC:{session_id}:{planning_state}",
                errors,
            )
            continue

        need(
            planning_state == "CONCRETIZED",
            f"PLANNING_STATE:{session_id}:{planning_state}",
            errors,
        )
        doc = ctx.load(planning_path)
        if doc.get("natural_language") == "FORBIDDEN":
            scan_machine(doc, planning_path, errors)

        need(
            doc.get("document_type") == "session_work_plan",
            f"PLANNING_DOCUMENT_TYPE:{session_id}",
            errors,
        )
        plan_session = doc.get("session", {})
        need(plan_session.get("id") == session_id, f"PLANNING_SESSION_ID:{session_id}", errors)
        need(
            plan_session.get("type") == session.get("type"),
            f"PLANNING_SESSION_TYPE:{session_id}",
            errors,
        )
        need(
            plan_session.get("distribution_contract_version")
            == ctx.plan["version"]["distribution_contract_version"],
            f"PLANNING_VERSION:{session_id}",
            errors,
        )
        need(
            plan_session.get("branch") == ctx.plan["version"]["branch"],
            f"PLANNING_BRANCH:{session_id}",
            errors,
        )

        approval = doc.get("approval", {})
        need(
            approval.get("planning") == "APPROVED",
            f"PLANNING_APPROVAL:{session_id}",
            errors,
        )
        if session.get("approval") != "APPROVED":
            need(
                approval.get("implementation") == "REQUIRED",
                f"PLANNING_IMPLEMENTATION_APPROVAL:{session_id}",
                errors,
            )
            need(
                approval.get("implementation_materialization") == "FORBIDDEN_BEFORE_APPROVAL",
                f"PLANNING_MATERIALIZATION_GUARD:{session_id}",
                errors,
            )

        implementation = doc.get("implementation", {})
        need(
            isinstance(implementation.get("repository"), str)
            and bool(implementation.get("repository")),
            f"PLANNING_IMPLEMENTATION_REPOSITORY:{session_id}",
            errors,
        )
        need(
            isinstance(implementation.get("branch"), str)
            and bool(implementation.get("branch")),
            f"PLANNING_IMPLEMENTATION_BRANCH:{session_id}",
            errors,
        )

        work_units = doc.get("work_units", [])
        need(bool(work_units), f"PLANNING_WORK_UNITS_EMPTY:{session_id}", errors)
        ids = [unit.get("id") for unit in work_units]
        need(len(ids) == len(set(ids)), f"PLANNING_WORK_UNIT_DUPLICATE:{session_id}", errors)
        allowed_states = {"PLANNED", "BLOCKED", "COMPLETE"}
        for unit in work_units:
            need(
                unit.get("state") in allowed_states,
                f"PLANNING_WORK_UNIT_STATE:{session_id}:{unit.get('id')}:{unit.get('state')}",
                errors,
            )
            depends_on = unit.get("depends_on", [])
            need(
                isinstance(depends_on, list),
                f"PLANNING_DEPENDS_ON_LIST:{session_id}:{unit.get('id')}",
                errors,
            )
            if isinstance(depends_on, list):
                for dependency in depends_on:
                    if isinstance(dependency, str) and dependency.startswith(f"{session_id}-W"):
                        need(
                            dependency in ids,
                            f"PLANNING_DEPENDENCY_UNKNOWN:{session_id}:{unit.get('id')}:{dependency}",
                            errors,
                        )

        migration = doc.get("responsibility_migration", {})
        source = migration.get("source", {})
        source_id = source.get("id")
        if source_id is not None:
            need(
                source_id in responsibilities,
                f"PLANNING_RESP_SOURCE:{session_id}:{source_id}",
                errors,
            )
        proposed = migration.get("proposed", [])
        proposed_ids = [entry.get("id") for entry in proposed]
        need(
            len(proposed_ids) == len(set(proposed_ids)),
            f"PLANNING_RESP_PROPOSAL_DUPLICATE:{session_id}",
            errors,
        )
        for entry in proposed:
            proposed_id = entry.get("id")
            authority_id = entry.get("authority")
            need(
                isinstance(proposed_id, str) and bool(proposed_id),
                f"PLANNING_RESP_PROPOSAL_ID:{session_id}:{proposed_id}",
                errors,
            )
            need(
                authority_id in authority_ids,
                f"PLANNING_RESP_PROPOSAL_AUTHORITY:{session_id}:{proposed_id}:{authority_id}",
                errors,
            )
            if proposed_id in responsibilities:
                need(
                    responsibilities[proposed_id].get("subject") == authority_id,
                    f"PLANNING_RESP_PROPOSAL_SUBJECT:{session_id}:{proposed_id}:{authority_id}",
                    errors,
                )

        proposed_gates = doc.get("proposed_gates", [])
        need(bool(proposed_gates), f"PLANNING_GATES_EMPTY:{session_id}", errors)
        need(
            len(proposed_gates) == len(set(proposed_gates)),
            f"PLANNING_GATE_DUPLICATE:{session_id}",
            errors,
        )
        for gate_id in proposed_gates:
            need(
                gate_id in gate_ids,
                f"PLANNING_GATE_UNKNOWN:{session_id}:{gate_id}",
                errors,
            )

        if "source_task" in doc:
            validate_bound_task(ctx, session_id, doc, errors)

    if isinstance(index_next, dict):
        next_id = index_next.get("id")
        if next_id in plan_sessions:
            plan_next = plan_sessions[next_id]
            need(
                index_next.get("planning_state") == plan_next.get("planning_state"),
                f"NEXT_PLANNING_STATE:{next_id}",
                errors,
            )
            need(
                index_next.get("planning_document") == plan_next.get("planning_document"),
                f"NEXT_PLANNING_DOCUMENT:{next_id}",
                errors,
            )
