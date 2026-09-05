from __future__ import annotations

from .common import need
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    vocabulary = {key: set(values) for key, values in ctx.vocabulary["dimensions"].items()}
    responsibilities = ctx.responsibilities["responsibilities"]
    descriptions = ctx.descriptions.get("descriptions", {})
    rationales = ctx.rationale.get("rationales", {})
    version = ctx.plan["version"]["distribution_contract_version"]
    plan_sessions = {session["id"]: session for session in ctx.plan["sessions"]}

    for responsibility_id, responsibility in responsibilities.items():
        interpretation = responsibility.get("interpretation")
        need(
            isinstance(interpretation, dict),
            f"RESP_INTERPRETATION:{responsibility_id}",
            errors,
        )
        if not isinstance(interpretation, dict):
            continue

        coverage = interpretation.get("semantic_coverage")
        need(
            coverage in vocabulary["semantic_coverage"],
            f"RESP_COVERAGE:{responsibility_id}:{coverage}",
            errors,
        )

        description_id = interpretation.get("responsibility_description_id")
        if coverage == "COMPLETE":
            need(
                description_id is None,
                f"RESP_COMPLETE_WITH_DESCRIPTION:{responsibility_id}:{description_id}",
                errors,
            )
        elif coverage == "PARTIAL":
            need(
                description_id is not None,
                f"RESP_PARTIAL_WITHOUT_DESCRIPTION:{responsibility_id}",
                errors,
            )
        need(
            description_id is None or description_id in descriptions,
            f"RESP_DESCRIPTION:{responsibility_id}:{description_id}",
            errors,
        )

        rationale_required = interpretation.get("rationale_required")
        need(
            isinstance(rationale_required, bool),
            f"RESP_RATIONALE_REQUIRED:{responsibility_id}",
            errors,
        )
        rationale_ids = interpretation.get("decision_rationale_ids", [])
        need(
            isinstance(rationale_ids, list),
            f"RESP_RATIONALE_LIST:{responsibility_id}",
            errors,
        )
        if rationale_required is True:
            need(bool(rationale_ids), f"RESP_RATIONALE_MISSING:{responsibility_id}", errors)

        for rationale_id in rationale_ids:
            need(
                rationale_id in rationales,
                f"RESP_RATIONALE_UNKNOWN:{responsibility_id}:{rationale_id}",
                errors,
            )
            if rationale_id in rationales:
                rationale = rationales[rationale_id]
                need(
                    rationale.get("status") == "ACTIVE",
                    f"RESP_RATIONALE_INACTIVE:{responsibility_id}:{rationale_id}",
                    errors,
                )
                need(
                    responsibility_id in rationale.get("applies_to", []),
                    f"RESP_RATIONALE_SCOPE:{responsibility_id}:{rationale_id}",
                    errors,
                )

    for description_id, entry in descriptions.items():
        need(
            entry.get("status") in vocabulary["description_status"],
            f"DESCRIPTION_STATUS:{description_id}",
            errors,
        )
        need(
            entry.get("semantic_role") == "UNMODELED_AUTHORITY_SEMANTIC",
            f"DESCRIPTION_ROLE:{description_id}",
            errors,
        )
        applies_to = entry.get("applies_to", [])
        need(bool(applies_to), f"DESCRIPTION_SCOPE_EMPTY:{description_id}", errors)
        for responsibility_id in applies_to:
            need(
                responsibility_id in responsibilities,
                f"DESCRIPTION_RESP_UNKNOWN:{description_id}:{responsibility_id}",
                errors,
            )
        text_value = entry.get("text")
        need(
            isinstance(text_value, str) and bool(text_value.strip()),
            f"DESCRIPTION_TEXT_EMPTY:{description_id}",
            errors,
        )

    for rationale_id, entry in rationales.items():
        status = entry.get("status")
        need(
            status in vocabulary["rationale_status"],
            f"RATIONALE_STATUS:{rationale_id}:{status}",
            errors,
        )

        applies_to = entry.get("applies_to", [])
        need(bool(applies_to), f"RATIONALE_SCOPE_EMPTY:{rationale_id}", errors)
        for responsibility_id in applies_to:
            need(
                responsibility_id in responsibilities,
                f"RATIONALE_RESP_UNKNOWN:{rationale_id}:{responsibility_id}",
                errors,
            )

        for trigger in entry.get("review_on", []):
            need(
                trigger in vocabulary["review_trigger"],
                f"RATIONALE_REVIEW_TRIGGER:{rationale_id}:{trigger}",
                errors,
            )

        statement = entry.get("statement")
        need(
            isinstance(statement, str) and bool(statement.strip()),
            f"RATIONALE_STATEMENT_EMPTY:{rationale_id}",
            errors,
        )

        supersedes = entry.get("supersedes", [])
        superseded_by = entry.get("superseded_by")
        for other_id in supersedes:
            need(
                other_id in rationales,
                f"RATIONALE_SUPERSEDES_UNKNOWN:{rationale_id}:{other_id}",
                errors,
            )
        need(
            superseded_by is None or superseded_by in rationales,
            f"RATIONALE_SUPERSEDED_BY_UNKNOWN:{rationale_id}:{superseded_by}",
            errors,
        )
        if status == "ACTIVE":
            need(
                superseded_by is None,
                f"RATIONALE_ACTIVE_SUPERSEDED:{rationale_id}",
                errors,
            )
        if status == "SUPERSEDED":
            need(
                superseded_by is not None,
                f"RATIONALE_SUPERSEDED_WITHOUT_SUCCESSOR:{rationale_id}",
                errors,
            )

        established = entry.get("established_in", {})
        established_version = established.get("version")
        established_session = established.get("session")
        need(
            established_version in ctx.index["versions"],
            f"RATIONALE_VERSION:{rationale_id}:{established_version}",
            errors,
        )
        if established_version == version:
            need(
                established_session in plan_sessions,
                f"RATIONALE_SESSION:{rationale_id}:{established_session}",
                errors,
            )

    for rationale_id, entry in rationales.items():
        for predecessor_id in entry.get("supersedes", []):
            if predecessor_id in rationales:
                need(
                    rationales[predecessor_id].get("superseded_by") == rationale_id,
                    f"RATIONALE_SUPERSESSION_LINK:{rationale_id}:{predecessor_id}",
                    errors,
                )
