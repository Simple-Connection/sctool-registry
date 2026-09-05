from __future__ import annotations

from .common import need, scan_machine
from .context import ValidationContext
from .state import derive_session_state


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    plan = ctx.plan
    index = ctx.index
    version = plan["version"]["distribution_contract_version"]
    responsibilities = ctx.responsibilities["responsibilities"]
    descriptions = ctx.descriptions.get("descriptions", {})
    rationales = ctx.rationale.get("rationales", {})
    gate_ids = set(ctx.gate_registry["gates"])
    state_rules = ctx.state_rules
    materialization = state_rules["materialization"]

    plan_sessions = {session["id"]: session for session in plan["sessions"]}
    index_sessions = {
        session["id"]: session for session in index["versions"][version]["sessions"]
    }

    for session_id, index_session in index_sessions.items():
        need(
            session_id in plan_sessions,
            f"INDEX_SESSION_UNKNOWN:{session_id}",
            errors,
        )
        if session_id in plan_sessions:
            plan_session = plan_sessions[session_id]
            need(
                index_session["state"] == plan_session["state"],
                f"INDEX_STATE:{session_id}",
                errors,
            )
            need(
                index_session.get("document") == plan_session.get("document"),
                f"INDEX_DOCUMENT:{session_id}",
                errors,
            )

    for session_id, plan_session in plan_sessions.items():
        for responsibility_id in plan_session.get("responsibility_refs", []):
            need(
                responsibility_id in responsibilities,
                f"PLAN_RESP:{session_id}:{responsibility_id}",
                errors,
            )

        document_path = plan_session.get("document")
        approval = plan_session.get("approval")
        if document_path is None:
            if materialization["document_requires_approval"]:
                need(
                    approval != materialization["approved_value"],
                    f"APPROVED_WITHOUT_DOC:{session_id}",
                    errors,
                )
            need(
                approval in materialization["unmaterialized_approval_values"],
                f"UNMATERIALIZED_APPROVAL:{session_id}:{approval}",
                errors,
            )
            need(
                plan_session["state"] in materialization["unmaterialized_plan_states"],
                f"UNMATERIALIZED_STATE:{session_id}:{plan_session['state']}",
                errors,
            )
            continue

        if materialization["document_requires_approval"]:
            need(
                approval == materialization["approved_value"],
                f"MATERIALIZED_WITHOUT_APPROVAL:{session_id}:{approval}",
                errors,
            )

        doc = ctx.load(document_path)
        if doc.get("natural_language") == "FORBIDDEN":
            scan_machine(doc, document_path, errors)

        need(
            doc.get("document_type") == "machine_session",
            f"SESSION_TYPE:{session_id}",
            errors,
        )
        need(doc["session"]["id"] == session_id, f"SESSION_ID:{session_id}", errors)
        need(
            doc["session"]["type"] == plan_session["type"],
            f"SESSION_TEMPLATE_TYPE:{session_id}",
            errors,
        )
        need(
            doc["session"]["approval"] == approval,
            f"SESSION_APPROVAL:{session_id}",
            errors,
        )
        need(
            doc["session"]["distribution_contract_version"] == version,
            f"SESSION_VERSION:{session_id}",
            errors,
        )
        need(
            doc["session"]["branch"] == plan["version"]["branch"],
            f"SESSION_BRANCH:{session_id}",
            errors,
        )
        need(
            doc["session"]["improvement_plan"] == ctx.plan_path,
            f"SESSION_PLAN:{session_id}",
            errors,
        )

        routing = doc["routing"]
        need(
            routing["docs_index"] == ctx.index_path,
            f"SESSION_DOCS_INDEX_ROUTE:{session_id}",
            errors,
        )
        need(
            routing["rules_index"] == ctx.rules_index_path,
            f"SESSION_RULES_ROUTE:{session_id}",
            errors,
        )
        need(
            routing["template_index"] == ctx.template_index_path,
            f"SESSION_TEMPLATE_ROUTE:{session_id}",
            errors,
        )
        need(
            routing["responsibility_index"] == ctx.responsibility_index_path,
            f"SESSION_RESP_ROUTE:{session_id}",
            errors,
        )
        need(
            routing["essential_template"]
            == ctx.template_index["routes"]["session_document"]["essential"]["template"],
            f"SESSION_ESSENTIAL_ROUTE:{session_id}",
            errors,
        )
        need(
            routing["type_template"]
            == ctx.template_index["routes"]["session_document"]["types"][plan_session["type"]]["template"],
            f"SESSION_TYPE_ROUTE:{session_id}",
            errors,
        )

        need(
            doc["state"] == {
                "mode": "DERIVED",
                "ruleset": state_rules["ruleset_id"],
            },
            f"SESSION_STATE_MODE:{session_id}",
            errors,
        )

        evidence = doc.get("evidence", [])
        evidence_ids = {entry["id"] for entry in evidence}
        need(
            len(evidence_ids) == len(evidence),
            f"EVIDENCE_DUPLICATE:{session_id}",
            errors,
        )

        responsibility_model = doc.get("responsibility_model", {})
        session_description_ids = responsibility_model.get("description_ids", [])
        session_rationale_ids = responsibility_model.get("rationale_ids", [])
        need(
            isinstance(session_description_ids, list),
            f"SESSION_DESCRIPTION_LIST:{session_id}",
            errors,
        )
        need(
            isinstance(session_rationale_ids, list),
            f"SESSION_RATIONALE_LIST:{session_id}",
            errors,
        )

        for description_id in session_description_ids:
            need(
                description_id in descriptions,
                f"SESSION_DESCRIPTION_UNKNOWN:{session_id}:{description_id}",
                errors,
            )
        for rationale_id in session_rationale_ids:
            need(
                rationale_id in rationales,
                f"SESSION_RATIONALE_UNKNOWN:{session_id}:{rationale_id}",
                errors,
            )
            if rationale_id in rationales:
                need(
                    rationales[rationale_id].get("status") == "ACTIVE",
                    f"SESSION_RATIONALE_INACTIVE:{session_id}:{rationale_id}",
                    errors,
                )

        payload = doc.get("payload", {})
        need(
            set(payload.get("responsibility_description_ids", []))
            == set(session_description_ids),
            f"SESSION_DESCRIPTION_PAYLOAD_MISMATCH:{session_id}",
            errors,
        )
        need(
            set(payload.get("decision_rationale_ids", []))
            == set(session_rationale_ids),
            f"SESSION_RATIONALE_PAYLOAD_MISMATCH:{session_id}",
            errors,
        )

        used_responsibilities: set[str] = set()
        for effect, refs in responsibility_model.get("effects", {}).items():
            for responsibility_id in refs:
                need(
                    responsibility_id in responsibilities,
                    f"SESSION_RESP:{session_id}:{effect}:{responsibility_id}",
                    errors,
                )
                used_responsibilities.add(responsibility_id)

        for work_unit in doc.get("work_units", []):
            for responsibility_id in work_unit.get("responsibility_refs", []):
                need(
                    responsibility_id in responsibilities,
                    f"WORK_RESP:{session_id}:{work_unit['id']}:{responsibility_id}",
                    errors,
                )
                used_responsibilities.add(responsibility_id)

        for gate in doc.get("gates", []):
            need(
                gate["id"] in gate_ids,
                f"GATE_ID:{session_id}:{gate['id']}",
                errors,
            )
            if gate["status"] == state_rules["derivation"]["closed_gate_status"]:
                need(
                    bool(gate.get("evidence_refs")),
                    f"GATE_NO_EVIDENCE:{session_id}:{gate['id']}",
                    errors,
                )
            for evidence_id in gate.get("evidence_refs", []):
                need(
                    evidence_id in evidence_ids,
                    f"GATE_EVIDENCE:{session_id}:{gate['id']}:{evidence_id}",
                    errors,
                )

        expected_state = state_rules["plan_state_map"].get(plan_session["state"])
        need(
            expected_state is not None,
            f"PLAN_STATE_UNMAPPED:{session_id}:{plan_session['state']}",
            errors,
        )
        if expected_state is not None:
            actual_state = derive_session_state(doc, state_rules)
            need(
                actual_state == expected_state,
                f"DERIVED_STATE:{session_id}:{actual_state}:{expected_state}",
                errors,
            )

        for responsibility_id in plan_session.get("responsibility_refs", []):
            need(
                responsibility_id in used_responsibilities,
                f"PLAN_RESP_UNUSED:{session_id}:{responsibility_id}",
                errors,
            )
            if responsibility_id not in responsibilities:
                continue
            interpretation = responsibilities[responsibility_id].get("interpretation", {})
            description_id = interpretation.get("responsibility_description_id")
            if description_id is not None:
                need(
                    description_id in session_description_ids,
                    f"SESSION_REQUIRED_DESCRIPTION:{session_id}:{responsibility_id}:{description_id}",
                    errors,
                )
            for rationale_id in interpretation.get("decision_rationale_ids", []):
                need(
                    rationale_id in session_rationale_ids,
                    f"SESSION_REQUIRED_RATIONALE:{session_id}:{responsibility_id}:{rationale_id}",
                    errors,
                )

    current_session_id = index["current"].get("current_session")
    current_document = index["current"].get("current_session_document")
    if current_session_id is None:
        if materialization["current_session_null_requires_document_null"]:
            need(current_document is None, "CURRENT_SESSION_DOCUMENT", errors)
    else:
        need(
            current_session_id in plan_sessions,
            f"CURRENT_SESSION_UNKNOWN:{current_session_id}",
            errors,
        )
        if current_session_id in plan_sessions:
            need(
                current_document == plan_sessions[current_session_id].get("document"),
                f"CURRENT_SESSION_DOCUMENT:{current_session_id}",
                errors,
            )

    next_session = index["current"].get("next_session")
    if isinstance(next_session, dict):
        next_session_id = next_session.get("id")
        if next_session_id is not None:
            need(
                next_session_id in plan_sessions,
                f"NEXT_SESSION_UNKNOWN:{next_session_id}",
                errors,
            )
            if next_session_id in plan_sessions:
                plan_next = plan_sessions[next_session_id]
                need(
                    next_session.get("state") == plan_next.get("state"),
                    f"NEXT_SESSION_STATE:{next_session_id}",
                    errors,
                )
                need(
                    next_session.get("document") == plan_next.get("document"),
                    f"NEXT_SESSION_DOCUMENT:{next_session_id}",
                    errors,
                )
            need(
                plan["next"]["session_id"] == next_session_id,
                f"PLAN_NEXT_SESSION:{next_session_id}",
                errors,
            )
            need(
                plan["next"]["state"] == next_session.get("state"),
                f"PLAN_NEXT_STATE:{next_session_id}",
                errors,
            )
