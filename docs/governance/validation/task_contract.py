from __future__ import annotations

import hashlib
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .common import need

if TYPE_CHECKING:
    from .context import ValidationContext

_SUPPORTED_SCHEMA = "sc_task/v1"
_SUPPORTED_ALGORITHM = "SHA256"\n_SUPPORTED_CANONICALIZATION = "UTF8_LF"
_COVERAGE_PATHS = {
    "scope.add",
    "scope.preserve",
    "scope.forbid",
    "tests.required",
    "verification.must_pass",
    "completion.require",
}


def _dig(value: dict[str, Any], dotted: str) -> Any:
    current: Any = value
    for segment in dotted.split("."):
        if not isinstance(current, dict) or segment not in current:
            return None
        current = current[segment]
    return current


def _task_refs(task_doc: dict[str, Any], coverage: list[str]) -> set[str]:
    refs: set[str] = set()
    for dotted in coverage:
        values = _dig(task_doc, dotted)
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str):
                refs.add(f"{dotted}:{value}")
    return refs


def validate_bound_task(
    ctx: ValidationContext,
    session_id: str,
    work_plan: dict[str, Any],
    errors: list[str],
) -> None:
    binding = work_plan.get("source_task")
    need(isinstance(binding, dict), f"TASK_BINDING:{session_id}", errors)
    if not isinstance(binding, dict):
        return

    document = binding.get("document")
    need(
        isinstance(document, str) and bool(document),
        f"TASK_DOCUMENT:{session_id}",
        errors,
    )
    if not isinstance(document, str) or not document:
        return

    task_path = ctx.root / document
    need(task_path.is_file(), f"TASK_FILE:{session_id}:{document}", errors)
    if not task_path.is_file():
        return

    raw = task_path.read_bytes()
    try:
        canonical = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
    except UnicodeDecodeError:
        errors.append(f"TASK_UTF8:{session_id}:{document}")
        return
    actual_sha256 = hashlib.sha256(canonical).hexdigest()
    digest = binding.get("digest")
    need(isinstance(digest, dict), f"TASK_DIGEST:{session_id}", errors)
    if not isinstance(digest, dict):
        return
    need(
        digest.get("algorithm") == _SUPPORTED_ALGORITHM,
        f"TASK_DIGEST_ALGORITHM:{session_id}:{digest.get('algorithm')}",
        errors,
    )
    need(
        digest.get("canonicalization") == _SUPPORTED_CANONICALIZATION,
        f"TASK_DIGEST_CANONICALIZATION:{session_id}:{digest.get('canonicalization')}",
        errors,
    )
    need(
        digest.get("value") == actual_sha256,
        f"TASK_SHA256:{session_id}:{actual_sha256}",
        errors,
    )

    task_doc = ctx.load(document)
    need(task_doc.get("schema") == _SUPPORTED_SCHEMA, f"TASK_SCHEMA:{session_id}", errors)
    need(
        binding.get("schema") == task_doc.get("schema"),
        f"TASK_SCHEMA_BINDING:{session_id}",
        errors,
    )

    task = task_doc.get("task")
    need(isinstance(task, dict), f"TASK_ROOT:{session_id}", errors)
    if not isinstance(task, dict):
        return

    need(binding.get("id") == task.get("id"), f"TASK_ID:{session_id}", errors)
    need(task.get("mode") == "implement", f"TASK_MODE:{session_id}:{task.get('mode')}", errors)
    need(task.get("output") == "machine", f"TASK_OUTPUT:{session_id}:{task.get('output')}", errors)

    target = task.get("target")
    need(isinstance(target, dict), f"TASK_TARGET:{session_id}", errors)
    if isinstance(target, dict):
        implementation = work_plan.get("implementation", {})
        baseline = work_plan.get("baseline", {})
        need(
            implementation.get("repository") == target.get("expected_repo"),
            f"TASK_REPOSITORY:{session_id}",
            errors,
        )
        need(
            baseline.get("package") == target.get("package"),
            f"TASK_PACKAGE:{session_id}",
            errors,
        )
        need(
            baseline.get("expected_version") == target.get("version_from"),
            f"TASK_VERSION_FROM:{session_id}",
            errors,
        )
        need(
            baseline.get("target_version") == target.get("version_to"),
            f"TASK_VERSION_TO:{session_id}",
            errors,
        )

    baseline = work_plan.get("baseline", {})
    need(
        baseline.get("preflight") == task.get("preflight"),
        f"TASK_PREFLIGHT:{session_id}",
        errors,
    )
    need(
        baseline.get("blocking_conditions") == task.get("stop_if"),
        f"TASK_STOP_IF:{session_id}",
        errors,
    )

    scope = task_doc.get("scope")
    boundary = work_plan.get("boundary")
    need(isinstance(scope, dict), f"TASK_SCOPE:{session_id}", errors)
    need(isinstance(boundary, dict), f"PLAN_BOUNDARY:{session_id}", errors)
    if isinstance(scope, dict) and isinstance(boundary, dict):
        for key in ("add", "preserve", "forbid"):
            need(
                boundary.get(key) == scope.get(key),
                f"TASK_SCOPE_{key.upper()}:{session_id}",
                errors,
            )

    verification = task_doc.get("verification")
    plan_verification = work_plan.get("verification")
    need(isinstance(verification, dict), f"TASK_VERIFICATION:{session_id}", errors)
    need(isinstance(plan_verification, dict), f"PLAN_VERIFICATION:{session_id}", errors)
    if isinstance(verification, dict) and isinstance(plan_verification, dict):
        need(
            plan_verification.get("must_pass") == verification.get("must_pass"),
            f"TASK_VERIFICATION_MUST_PASS:{session_id}",
            errors,
        )
        need(
            plan_verification.get("on_failure") == verification.get("on_failure"),
            f"TASK_VERIFICATION_FAILURE:{session_id}",
            errors,
        )

    need(
        work_plan.get("handoff") == task_doc.get("handoff"),
        f"TASK_HANDOFF:{session_id}",
        errors,
    )
    need(
        work_plan.get("completion") == task_doc.get("completion"),
        f"TASK_COMPLETION:{session_id}",
        errors,
    )

    task_contract = work_plan.get("task_contract")
    need(isinstance(task_contract, dict), f"TASK_CONTRACT:{session_id}", errors)
    if not isinstance(task_contract, dict):
        return

    coverage = task_contract.get("coverage")
    need(isinstance(coverage, list), f"TASK_COVERAGE_LIST:{session_id}", errors)
    if not isinstance(coverage, list):
        return
    need(
        len(coverage) == len(set(coverage)),
        f"TASK_COVERAGE_DUPLICATE:{session_id}",
        errors,
    )
    need(
        set(coverage) == _COVERAGE_PATHS,
        f"TASK_COVERAGE_PATHS:{session_id}",
        errors,
    )

    expected_refs = _task_refs(task_doc, coverage)
    actual_refs: list[str] = []
    for unit in work_plan.get("work_units", []):
        refs = unit.get("task_refs", [])
        need(
            isinstance(refs, list),
            f"TASK_REFS_LIST:{session_id}:{unit.get('id')}",
            errors,
        )
        if isinstance(refs, list):
            actual_refs.extend(ref for ref in refs if isinstance(ref, str))

    actual_ref_set = set(actual_refs)
    need(
        len(actual_refs) == len(actual_ref_set),
        f"TASK_REF_DUPLICATE:{session_id}",
        errors,
    )
    for ref in sorted(actual_ref_set - expected_refs):
        errors.append(f"TASK_REF_UNKNOWN:{session_id}:{ref}")
    for ref in sorted(expected_refs - actual_ref_set):
        errors.append(f"TASK_REF_UNCOVERED:{session_id}:{ref}")
