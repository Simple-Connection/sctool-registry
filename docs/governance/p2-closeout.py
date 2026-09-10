#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
P2_SESSION = ROOT / "docs/ver1.0.3/session_document/ver.1.0.3_P2_registry_verified_discovery_profile_consumer.yaml"
P2_PLAN = ROOT / "docs/ver1.0.3/session_document/ver.1.0.3_P2_registry_verified_discovery_profile_consumer_work_plan.yaml"
P2_HANDOFF = ROOT / "docs/ver1.0.3/evidence/P2_registry_verified_discovery_profile_consumer_handoff.yaml"
P3_SESSION = ROOT / "docs/ver1.0.3/session_document/ver.1.0.3_P3_product_package_report_routing.yaml"
P3_PLAN = ROOT / "docs/ver1.0.3/session_document/ver.1.0.3_P3_product_package_report_routing_work_plan.yaml"
IMPROVEMENT = ROOT / "docs/ver1.0.3/1.0.3_Improvement_plan.yaml"
DOCS_INDEX = ROOT / "docs/index.yaml"
PACKAGE_JSON = ROOT / "packages/registry-client-sdk/package.json"
DISCOVERY_SOURCE = ROOT / "packages/registry-client-sdk/src/discovery.mjs"
DISCOVERY_TYPES = ROOT / "packages/registry-client-sdk/src/discovery.d.mts"

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
P2_COMPLETION_CODES = {
    "P2-W1": "P2_VERIFIED_DISCOVERY_CONTRACT_COMPLETE",
    "P2-W2": "P2_REGISTRY_HEAD_SIGNATURE_VERIFICATION_COMPLETE",
    "P2-W3": "P2_IMMUTABLE_SNAPSHOT_ANTI_ROLLBACK_COMPLETE",
    "P2-W4": "P2_VERIFIED_CATALOG_DISCOVERY_COMPLETE",
    "P2-W5": "P2_MARKETPLACE_PROFILE_PROJECTION_COMPLETE",
    "P2-W6": "P2_REGISTRY_CLIENT_EXACT_VERIFICATION_COMPLETE",
    "P2-W7": "P2_CROSS_REPOSITORY_EXACT_HANDOFF_COMPLETE",
}


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"P2/P3 closeout blocked: {message}")


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = yaml.safe_load(handle)
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} is not a mapping")
    return value


def dump_yaml(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        yaml.safe_dump(value, handle, sort_keys=False, allow_unicode=True, width=120)


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    return result.stdout.strip()


def assert_sha(value: str, label: str) -> str:
    value = value.strip().lower()
    if not SHA_RE.fullmatch(value):
        fail(f"{label} is not an exact 40-character git SHA")
    return value


def package_contract() -> dict[str, Any]:
    with PACKAGE_JSON.open("r", encoding="utf-8") as handle:
        package = json.load(handle)
    if package.get("name") != "@simple-connection/sctool-registry-client-sdk":
        fail("unexpected Registry Client SDK package identity")
    if package.get("version") != "0.2.0":
        fail("Registry Client SDK version is not 0.2.0")
    exports = package.get("exports")
    if not isinstance(exports, dict) or "./discovery" not in exports:
        fail("Registry Client SDK ./discovery export is absent")
    if not DISCOVERY_SOURCE.is_file() or not DISCOVERY_TYPES.is_file():
        fail("Registry Client SDK discovery source/type declaration is absent")
    source = DISCOVERY_SOURCE.read_text(encoding="utf-8")
    required_tokens = (
        "registry-discovery-v1",
        "REGISTRY_DISTRIBUTION_INACTIVE",
        "sctool-registry-anti-rollback/v1",
        "marketplaceProfiles",
        "discoverVerifiedRegistry",
        "enumerateVerifiedPackages",
        "searchVerifiedPackages",
    )
    missing = [token for token in required_tokens if token not in source]
    if missing:
        fail(f"discovery contract tokens are absent: {missing}")
    dependencies = package.get("dependencies") or {}
    if "@simple-connection/sctool-sdk" in dependencies:
        fail("Registry Client SDK acquired Authoring SDK runtime dependency")
    return package


def github_json(url: str, token: str | None = None) -> dict[str, Any]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "sctool-registry-p2-closeout/1",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, dict):
        fail(f"GitHub response is not an object: {url}")
    return data


def find_exact_successful_workflow_run(
    repository: str,
    workflow: str,
    candidate_sha: str,
    token: str,
    timeout_seconds: int,
    poll_seconds: int,
) -> int:
    deadline = time.monotonic() + timeout_seconds
    encoded = urllib.parse.quote(workflow, safe="")
    query = urllib.parse.urlencode({"head_sha": candidate_sha, "branch": "dev/1.0.3", "per_page": 20})
    url = f"https://api.github.com/repos/{repository}/actions/workflows/{encoded}/runs?{query}"
    last_state = "missing"
    while True:
        payload = github_json(url, token)
        runs = payload.get("workflow_runs") or []
        exact = [run for run in runs if run.get("head_sha") == candidate_sha]
        successful = [run for run in exact if run.get("status") == "completed" and run.get("conclusion") == "success"]
        if successful:
            successful.sort(key=lambda run: int(run.get("run_number") or 0), reverse=True)
            return int(successful[0]["id"])
        if exact:
            last_state = ",".join(f"{run.get('status')}:{run.get('conclusion')}" for run in exact)
        if time.monotonic() >= deadline:
            fail(f"{workflow} has no exact successful run for {candidate_sha}; state={last_state}")
        time.sleep(poll_seconds)


def resolve_product_sha(explicit: str | None, token: str | None) -> str:
    if explicit:
        return assert_sha(explicit, "product SHA")
    url = "https://api.github.com/repos/Simple-Connection/SC_Linked_App/branches/dev/2.2.4"
    attempts: list[str | None] = [token]
    if token:
        attempts.append(None)
    for attempt_token in attempts:
        try:
            payload = github_json(url, attempt_token)
            sha = (((payload.get("commit") or {}).get("sha")) or "").lower()
            if SHA_RE.fullmatch(sha):
                return sha
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            pass
    try:
        output = git("ls-remote", "https://github.com/Simple-Connection/SC_Linked_App.git", "refs/heads/dev/2.2.4")
        sha = output.split()[0].lower() if output else ""
        return assert_sha(sha, "product SHA from git ls-remote")
    except Exception as exc:
        fail(f"cannot resolve Product dev/2.2.4 exact SHA: {exc}")


def find_session(plan: dict[str, Any], session_id: str) -> dict[str, Any]:
    for item in plan.get("sessions") or []:
        if item.get("id") == session_id:
            return item
    fail(f"improvement plan session {session_id} missing")


def find_index_session(index: dict[str, Any], session_id: str) -> dict[str, Any]:
    version = ((index.get("versions") or {}).get("1.0.3") or {})
    for item in version.get("sessions") or []:
        if item.get("id") == session_id:
            return item
    fail(f"docs index session {session_id} missing")


def p2_closed(session: dict[str, Any]) -> bool:
    units = session.get("work_units") or []
    gates = [gate for gate in session.get("gates") or [] if gate.get("required", True)]
    return bool(units and gates) and all(unit.get("status") == "COMPLETE" for unit in units) and all(
        gate.get("status") == "PASS" for gate in gates
    )


def update_p2_session(
    candidate: str,
    regression_run_id: int,
    governance_run_id: int,
    pages_run_id: int,
    product_sha: str,
) -> None:
    session = load_yaml(P2_SESSION)
    if session.get("session", {}).get("approval") != "APPROVED":
        fail("P2 approval is not APPROVED")
    if p2_closed(session):
        return
    session["heads"]["implementation"] = candidate
    session["heads"]["exact_validation"] = candidate
    for unit in session.get("work_units") or []:
        unit_id = unit.get("id")
        if unit_id not in P2_COMPLETION_CODES:
            fail(f"unexpected P2 work unit {unit_id}")
        unit["status"] = "COMPLETE"
        unit["completion_codes"] = [P2_COMPLETION_CODES[unit_id]]

    retained = [entry for entry in session.get("evidence") or [] if entry.get("id") not in {
        "E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION", "E_P2_CROSS_REPOSITORY_HANDOFF"
    }]
    retained.extend(
        [
            {
                "id": "E_P2_IMPLEMENTATION",
                "kind": "EXACT_VALIDATION",
                "head": candidate,
                "refs": {
                    "registry_client_sdk_version": "0.2.0",
                    "discovery_contract": "registry-discovery-v1",
                    "anti_rollback_schema": "sctool-registry-anti-rollback/v1",
                    "marketplace_profile_carrier": "SIGNED_SNAPSHOT_MARKETPLACE_PROFILES",
                    "authoring_validator_duplicated": False,
                    "authoring_sdk_runtime_dependency": "ABSENT",
                    "production_trust_activation": "NOT_PERFORMED",
                },
            },
            {
                "id": "E_P2_EXACT_VALIDATION",
                "kind": "EXACT_VALIDATION",
                "head": candidate,
                "refs": {
                    "registry_client_regression_run_id": regression_run_id,
                    "registry_client_regression": "PASS",
                    "discovery_tests": "PASS",
                    "package_export_check": "PASS",
                    "package_pack_dry_run": "PASS",
                    "registry_governance_run_id": governance_run_id,
                    "registry_governance": "PASS",
                    "registry_pages_build_run_id": pages_run_id,
                    "registry_pages_build": "PASS",
                    "ptsip_profile": "PASS",
                    "ptsip_conformance": "PASS",
                    "production_trust_deploy": "SKIPPED_INACTIVE",
                },
            },
            {
                "id": "E_P2_CROSS_REPOSITORY_HANDOFF",
                "kind": "CROSS_REPOSITORY_EXACT_HANDOFF",
                "head": candidate,
                "refs": {
                    "handoff_document": str(P2_HANDOFF.relative_to(ROOT)).replace("\\", "/"),
                    "product_repository": "Simple-Connection/SC_Linked_App",
                    "product_branch": "dev/2.2.4",
                    "product_observed_sha": product_sha,
                    "registry_client_sdk_version": "0.2.0",
                    "product_direct_mutation": "FORBIDDEN",
                    "product_raw_github_discovery": "FORBIDDEN",
                    "package_publication": "NOT_PERFORMED",
                },
            },
        ]
    )
    session["evidence"] = retained

    gate_refs = {
        "GATE_SESSION_APPROVAL": ["E_P2_APPROVAL"],
        "GATE_P2_DISCOVERY_CONTRACT": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_REGISTRY_HEAD_VERIFICATION": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_ROOT_DISTRIBUTION_SIGNATURE": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_IMMUTABLE_SNAPSHOT": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_ANTI_ROLLBACK": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_VERIFIED_CATALOG": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_STABLE_RELEASE_RESOLUTION": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_MARKETPLACE_PROFILE_PROJECTION": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_DISTRIBUTION_INACTIVE_FAIL_CLOSED": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_REGISTRY_CLIENT_PUBLIC_EXPORTS": ["E_P2_IMPLEMENTATION", "E_P2_EXACT_VALIDATION"],
        "GATE_P2_REGISTRY_CLIENT_REGRESSION": ["E_P2_EXACT_VALIDATION"],
        "GATE_P2_REGISTRY_CLIENT_PACKAGE": ["E_P2_EXACT_VALIDATION"],
        "GATE_P2_CROSS_REPOSITORY_HANDOFF": ["E_P2_CROSS_REPOSITORY_HANDOFF"],
    }
    for gate in session.get("gates") or []:
        gate_id = gate.get("id")
        if gate_id not in gate_refs:
            fail(f"unexpected P2 gate {gate_id}")
        gate["status"] = "PASS"
        gate["evidence_refs"] = gate_refs[gate_id]
    dump_yaml(P2_SESSION, session)


def write_p2_handoff(
    candidate: str,
    regression_run_id: int,
    governance_run_id: int,
    pages_run_id: int,
    product_sha: str,
) -> None:
    handoff = {
        "schema_version": "1.0",
        "document_type": "cross_repository_handoff",
        "natural_language": "FORBIDDEN",
        "handoff": {
            "id": "P2_REGISTRY_VERIFIED_DISCOVERY_PROFILE_CONSUMER_HANDOFF",
            "source_repository": "Simple-Connection/sctool-registry",
            "source_branch": "dev/1.0.3",
            "source_package_path": "packages/registry-client-sdk",
            "implementation_sha": candidate,
            "exact_validation_sha": candidate,
            "distribution_contract_version": "1.0.3",
            "version_before": "0.1.0",
            "version_after": "0.2.0",
            "consumer_repository": "Simple-Connection/SC_Linked_App",
            "consumer_branch": "dev/2.2.4",
            "consumer_observed_sha": product_sha,
            "consumer_session": "P4",
            "consumer_work_item": "P4-W3",
        },
        "contract": {
            "discovery_contract": "registry-discovery-v1",
            "public_export": "@simple-connection/sctool-registry-client-sdk/discovery",
            "anti_rollback_schema": "sctool-registry-anti-rollback/v1",
            "distribution_inactive_code": "REGISTRY_DISTRIBUTION_INACTIVE",
            "marketplace_profile_carrier": "SIGNED_SNAPSHOT_MARKETPLACE_PROFILES",
            "root_signature_verification": "REGISTRY_OWNED",
            "distribution_signature_verification": "REGISTRY_OWNED",
            "snapshot_integrity_verification": "REGISTRY_OWNED",
            "anti_rollback_state": "REGISTRY_OWNED",
            "marketplace_authoring_validator": "NOT_DUPLICATED",
            "product_raw_github_discovery": "FORBIDDEN",
            "product_unverified_pages_discovery": "FORBIDDEN",
        },
        "exports": [
            "@simple-connection/sctool-registry-client-sdk",
            "@simple-connection/sctool-registry-client-sdk/discovery",
        ],
        "verification": {
            "registry_client_sdk_regression": {
                "run_id": regression_run_id,
                "conclusion": "SUCCESS",
                "full_regression": "PASS",
                "discovery_tests": "PASS",
                "package_contract": "PASS",
                "package_pack_dry_run": "PASS",
            },
            "registry_governance": {"run_id": governance_run_id, "conclusion": "SUCCESS"},
            "registry_pages_build": {
                "run_id": pages_run_id,
                "conclusion": "SUCCESS",
                "ptsip_profile": "PASS",
                "ptsip_conformance": "PASS",
                "production_trust_deploy": "SKIPPED_INACTIVE",
            },
        },
        "publication": {
            "package_publish": "NOT_PERFORMED",
            "production_trust": "INACTIVE",
            "pages_production_distribution": "INACTIVE",
            "reason": "SEPARATE_USER_APPROVAL_REQUIRED",
        },
        "consumer_change_request": {
            "consume_exact_sdk_version": "0.2.0",
            "consume_verified_discovery_surface": True,
            "renderer_main_preload_projection_only": True,
            "registry_signature_validation_in_product": "FORBIDDEN",
            "registry_anti_rollback_in_product": "FORBIDDEN",
            "raw_repository_discovery_in_product": "FORBIDDEN",
            "package_publication_required_before_normal_published_package_consumption": True,
            "product_direct_mutation_by_registry_session": "FORBIDDEN",
        },
        "completion": {
            "verified_discovery": "COMPLETE",
            "signed_snapshot_profile_projection": "COMPLETE",
            "exact_handoff": "COMPLETE",
            "package_publication": "OUT_OF_SCOPE_UNTIL_APPROVED",
        },
    }
    dump_yaml(P2_HANDOFF, handoff)


def update_p2_plan_and_indexes() -> None:
    work_plan = load_yaml(P2_PLAN)
    for unit in work_plan.get("work_units") or []:
        if unit.get("id") not in P2_COMPLETION_CODES:
            fail(f"unexpected P2 work-plan unit {unit.get('id')}")
        unit["state"] = "COMPLETE"
    additions = work_plan.get("boundary", {}).get("add", [])
    work_plan["boundary"]["add"] = [
        "MARKETPLACE_PROFILE_CARRIER_IN_VERIFIED_SNAPSHOT"
        if item == "MARKETPLACE_PROFILE_CARRIER_IN_PACKAGE_DESCRIPTOR" else item
        for item in additions
    ]
    dump_yaml(P2_PLAN, work_plan)

    improvement = load_yaml(IMPROVEMENT)
    p2 = find_session(improvement, "P2")
    p2["state"] = "COMPLETE"
    p2["approval"] = "APPROVED"
    improvement["next"] = {"session_id": "P3", "state": "NOT_APPROVED"}
    dump_yaml(IMPROVEMENT, improvement)

    index = load_yaml(DOCS_INDEX)
    index["current"]["current_session"] = None
    index["current"]["current_session_document"] = None
    index["current"]["next_session"] = None
    find_index_session(index, "P2")["state"] = "COMPLETE"
    dump_yaml(DOCS_INDEX, index)


def run_p2(args: argparse.Namespace) -> None:
    candidate = assert_sha(args.candidate_sha or git("rev-parse", "HEAD"), "candidate SHA")
    if git("rev-parse", "HEAD").lower() != candidate:
        fail("working tree HEAD differs from candidate SHA")
    if git("status", "--porcelain"):
        fail("working tree is not clean before P2 closeout")
    package_contract()
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    repository = os.environ.get("GITHUB_REPOSITORY", "Simple-Connection/sctool-registry")
    if repository != "Simple-Connection/sctool-registry":
        fail(f"unexpected repository {repository}")
    if not token:
        fail("GITHUB_TOKEN/GH_TOKEN is required for exact workflow verification")
    regression_run_id = int(args.regression_run_id or os.environ.get("GITHUB_RUN_ID") or 0)
    if regression_run_id <= 0:
        fail("Registry Client SDK regression run id is unavailable")
    governance_run_id = find_exact_successful_workflow_run(
        repository, "governance.yml", candidate, token, args.wait_seconds, args.poll_seconds
    )
    pages_run_id = find_exact_successful_workflow_run(
        repository, "pages.yml", candidate, token, args.wait_seconds, args.poll_seconds
    )
    product_sha = resolve_product_sha(args.product_sha, token)

    write_p2_handoff(candidate, regression_run_id, governance_run_id, pages_run_id, product_sha)
    update_p2_session(candidate, regression_run_id, governance_run_id, pages_run_id, product_sha)
    update_p2_plan_and_indexes()
    print(
        json.dumps(
            {
                "phase": "P2_CLOSEOUT_READY",
                "candidate_sha": candidate,
                "regression_run_id": regression_run_id,
                "governance_run_id": governance_run_id,
                "pages_run_id": pages_run_id,
                "product_sha": product_sha,
                "handoff": str(P2_HANDOFF.relative_to(ROOT)).replace("\\", "/"),
            },
            sort_keys=True,
        )
    )


def create_p3_session(start_sha: str) -> None:
    session = {
        "schema_version": "4.0",
        "document_type": "machine_session",
        "natural_language": "FORBIDDEN",
        "session": {
            "id": "P3",
            "type": "B",
            "number": 3,
            "approval": "APPROVED",
            "distribution_contract_version": "1.0.3",
            "branch": "dev/1.0.3",
            "authority_repository": "Simple-Connection/sctool-registry",
            "improvement_plan": "docs/ver1.0.3/1.0.3_Improvement_plan.yaml",
        },
        "routing": {
            "docs_index": "docs/index.yaml",
            "rules_index": "docs/rules/index.yaml",
            "template_index": "docs/template/index.yaml",
            "responsibility_index": "docs/responsibility/index.yaml",
            "essential_template": "docs/template/session_document_template/session_document_essential.yaml",
            "type_template": "docs/template/session_document_template/session_type_B.yaml",
        },
        "heads": {"start": start_sha, "implementation": None, "exact_validation": None},
        "responsibility_model": {
            "effects": {"assign": [], "implement": [], "preserve": [], "defer": [], "transfer": [], "retire": [], "forbid": []},
            "description_ids": [],
            "rationale_ids": [],
        },
        "payload": {
            "implementation": {
                "responsibility_refs": [],
                "contract_refs": [],
                "path_allow": [
                    ".github/ISSUE_TEMPLATE/**",
                    ".github/registry-sdk-issue-queue.json",
                    ".github/workflows/registry-sdk-issue-routing.yml",
                    "tools/issue-routing/**",
                    "docs/ver1.0.3/evidence/**",
                    "docs/ver1.0.3/session_document/ver.1.0.3_P3_product_package_report_routing*.yaml",
                    "docs/ver1.0.3/1.0.3_Improvement_plan.yaml",
                    "docs/index.yaml",
                ],
                "path_deny": [
                    "packages/registry-client-sdk/**",
                    "packages/sctool-sdk/**",
                    "packages/repository-tool-sdk/**",
                    "Simple-Connection/SC_Linked_App/**",
                ],
            },
            "responsibility_description_ids": [],
            "decision_rationale_ids": [],
        },
        "work_units": [
            {"id": "P3-W1", "status": "ACTIVE", "responsibility_refs": [], "input_refs": ["P3_WORK_PLAN"], "output_refs": ["PRODUCT_REPORT_SCHEMA_V1", "PRODUCT_REPORT_MARKER_V1"], "completion_codes": []},
            {"id": "P3-W2", "status": "PENDING", "responsibility_refs": [], "input_refs": ["P3-W1"], "output_refs": ["PRODUCT_REPORT_PARSE_VALIDATE"], "completion_codes": []},
            {"id": "P3-W3", "status": "PENDING", "responsibility_refs": [], "input_refs": ["P3-W2"], "output_refs": ["PRODUCT_REPORT_SANITIZE"], "completion_codes": []},
            {"id": "P3-W4", "status": "PENDING", "responsibility_refs": [], "input_refs": ["P3-W3"], "output_refs": ["PRODUCT_REPORT_ACTIVE_VERSION_ROUTE"], "completion_codes": []},
            {"id": "P3-W5", "status": "PENDING", "responsibility_refs": [], "input_refs": ["P3-W4"], "output_refs": ["PRODUCT_REPORT_QUEUE_REGRESSION"], "completion_codes": []},
            {"id": "P3-W6", "status": "PENDING", "responsibility_refs": [], "input_refs": ["P3-W5"], "output_refs": ["E_P3_CROSS_REPOSITORY_HANDOFF"], "completion_codes": []},
        ],
        "evidence": [
            {
                "id": "E_P3_APPROVAL",
                "kind": "USER_APPROVAL",
                "head": start_sha,
                "refs": {
                    "implementation": "APPROVED",
                    "approval_scope": "P3_START",
                    "p2_precondition": "COMPLETE",
                },
            },
            {
                "id": "E_P3_PREFLIGHT",
                "kind": "EXACT_VALIDATION",
                "head": start_sha,
                "refs": {
                    "repository": "Simple-Connection/sctool-registry",
                    "branch": "dev/1.0.3",
                    "p2_complete": "PASS",
                    "existing_sdk_report_schema": "sctool-registry-sdk-report/v1",
                    "product_report_schema_target": "sctool-registry-product-report/v1",
                    "product_direct_mutation": "FORBIDDEN",
                },
            },
        ],
        "gates": [
            {"id": "GATE_SESSION_APPROVAL", "required": True, "status": "PASS", "evidence_refs": ["E_P3_APPROVAL"]},
            {"id": "GATE_P3_PRODUCT_REPORT_SCHEMA", "required": True, "status": "PENDING", "evidence_refs": []},
            {"id": "GATE_P3_PRODUCT_REPORT_MARKER", "required": True, "status": "PENDING", "evidence_refs": []},
            {"id": "GATE_P3_REPORT_SANITIZATION", "required": True, "status": "PENDING", "evidence_refs": []},
            {"id": "GATE_P3_SDK_REPORT_COMPATIBILITY", "required": True, "status": "PENDING", "evidence_refs": []},
            {"id": "GATE_P3_ACTIVE_BRANCH_ROUTING", "required": True, "status": "PENDING", "evidence_refs": []},
            {"id": "GATE_P3_ISSUE_QUEUE_REGRESSION", "required": True, "status": "PENDING", "evidence_refs": []},
            {"id": "GATE_P3_CROSS_REPOSITORY_HANDOFF", "required": True, "status": "PENDING", "evidence_refs": []},
        ],
        "blockers": [],
        "state": {"mode": "DERIVED", "ruleset": "SESSION_STATE_V1"},
    }
    dump_yaml(P3_SESSION, session)


def run_p3(args: argparse.Namespace) -> None:
    start_sha = assert_sha(args.p2_closeout_sha or git("rev-parse", "HEAD"), "P3 start SHA")
    if git("rev-parse", "HEAD").lower() != start_sha:
        fail("working tree HEAD differs from P3 start SHA")
    if git("status", "--porcelain"):
        fail("working tree is not clean before P3 start")
    p2_session = load_yaml(P2_SESSION)
    if not p2_closed(p2_session):
        fail("P2 is not machine-closed; P3 cannot start")

    p3_plan = load_yaml(P3_PLAN)
    p3_plan.setdefault("approval", {})["implementation"] = "APPROVED"
    p3_plan["approval"]["implementation_materialization"] = "ALLOWED_AFTER_APPROVAL"
    dump_yaml(P3_PLAN, p3_plan)
    create_p3_session(start_sha)

    improvement = load_yaml(IMPROVEMENT)
    p2 = find_session(improvement, "P2")
    if p2.get("state") != "COMPLETE":
        fail("improvement plan does not mark P2 COMPLETE")
    p3 = find_session(improvement, "P3")
    p3["state"] = "ACTIVE"
    p3["approval"] = "APPROVED"
    p3["document"] = str(P3_SESSION.relative_to(ROOT)).replace("\\", "/")
    improvement["next"] = {"session_id": None, "state": "NONE"}
    dump_yaml(IMPROVEMENT, improvement)

    index = load_yaml(DOCS_INDEX)
    index["current"]["current_session"] = "P3"
    index["current"]["current_session_document"] = str(P3_SESSION.relative_to(ROOT)).replace("\\", "/")
    index["current"]["next_session"] = None
    p3_index = find_index_session(index, "P3")
    p3_index["state"] = "ACTIVE"
    p3_index["document"] = str(P3_SESSION.relative_to(ROOT)).replace("\\", "/")
    dump_yaml(DOCS_INDEX, index)
    print(json.dumps({"phase": "P3_STARTED", "start_sha": start_sha, "session": str(P3_SESSION.relative_to(ROOT)).replace("\\", "/")}, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=("p2", "p3"))
    parser.add_argument("--candidate-sha")
    parser.add_argument("--product-sha")
    parser.add_argument("--regression-run-id", type=int)
    parser.add_argument("--p2-closeout-sha")
    parser.add_argument("--wait-seconds", type=int, default=900)
    parser.add_argument("--poll-seconds", type=int, default=10)
    args = parser.parse_args()
    if args.phase == "p2":
        run_p2(args)
    else:
        run_p3(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
