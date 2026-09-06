#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml


def fail(message: str) -> None:
    raise SystemExit(f"Update candidate evidence validation FAIL: {message}")


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        fail("evidence root must be an object")
    return value


def load_yaml(path: Path) -> dict:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        fail("contract root must be an object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()

    contract = load_yaml(Path(args.contract))
    evidence = load_json(Path(args.evidence))
    automation = contract.get("automation_validation", {})
    if evidence.get("format") != automation.get("evidence_format"):
        fail("evidence format mismatch")
    if evidence.get("contract") != contract.get("contract_id"):
        fail("contract id mismatch")

    subject = evidence.get("subject", {})
    if subject.get("repository") != args.repository:
        fail("repository binding mismatch")
    if subject.get("revision") != args.revision:
        fail("revision binding mismatch")

    required_checks = set(automation.get("required_checks", []))
    checks = evidence.get("checks", {})
    if not isinstance(checks, dict):
        fail("checks must be an object")
    if set(checks) != required_checks:
        fail("required check coverage mismatch")
    for check_id in sorted(required_checks):
        if checks[check_id].get("status") != "PASS":
            fail(f"check did not pass: {check_id}")
        cases = checks[check_id].get("cases")
        if not isinstance(cases, int) or cases <= 0:
            fail(f"check case count invalid: {check_id}")

    required_states = set(automation.get("required_resolution_states", []))
    evidence_states = evidence.get("resolution_states", {})
    if set(evidence_states) != required_states:
        fail("resolution-state coverage mismatch")
    if any(status != "PASS" for status in evidence_states.values()):
        fail("resolution-state coverage did not pass")

    no_io = checks["GATE_UPDATE_NO_RETRIEVAL_WHEN_INELIGIBLE"]["details"]
    for state in ("CURRENT", "DOWNGRADE_NOT_CANDIDATE", "INVALID_OBSERVATION"):
        result = no_io.get(state, {})
        if result.get("text_requests") != 0 or result.get("asset_streams") != 0:
            fail(f"ineligible state performed retrieval: {state}")

    eligible = checks["GATE_UPDATE_RETRIEVAL_WHEN_ELIGIBLE"]["details"].get("UPDATE_AVAILABLE", {})
    if eligible.get("release_queries") != 1:
        fail("eligible path must resolve exactly one release")
    if eligible.get("asset_streams") != 1:
        fail("eligible path must retrieve exactly one artifact stream")
    if eligible.get("verified_candidate") is not True:
        fail("eligible path must produce a verified candidate")

    observation = checks["GATE_UPDATE_OBSERVATION_CONTRACT"]["details"]
    expected_observation = contract.get("installation_observation", {})
    if observation.get("authority") != expected_observation.get("authority"):
        fail("observation authority evidence mismatch")
    if observation.get("access") != expected_observation.get("access"):
        fail("observation access evidence mismatch")
    if observation.get("installed_version_role") != expected_observation.get("installed_version_role"):
        fail("installed-version role evidence mismatch")
    if observation.get("additional_fields") != expected_observation.get("additional_fields"):
        fail("additional-field evidence mismatch")

    precedence = checks["GATE_UPDATE_VERSION_PRECEDENCE"]["details"]
    expected_precedence = contract.get("version_precedence", {})
    if precedence.get("grammar") != expected_precedence.get("grammar"):
        fail("version grammar evidence mismatch")
    if precedence.get("build_metadata_ignored") is not True:
        fail("build metadata invariant missing")
    if precedence.get("prerelease_semver_precedence") is not True:
        fail("prerelease precedence invariant missing")
    if precedence.get("numeric_prerelease_integer") is not True:
        fail("numeric prerelease invariant missing")
    if precedence.get("large_numeric_integer_safe") is not True:
        fail("large numeric precedence invariant missing")

    boundary = checks["GATE_UPDATE_CANDIDATE_BOUNDARY"]["details"]
    if set(boundary.get("required_fields_checked", [])) != set(contract.get("required_fields", [])):
        fail("candidate required-field coverage mismatch")
    if set(boundary.get("forbidden_fields_checked", [])) != set(contract.get("forbidden_fields", [])):
        fail("candidate forbidden-field coverage mismatch")
    if boundary.get("raw_path_exposed") is not False:
        fail("raw staging path exposure detected")
    if boundary.get("write_access_exposed") is not False:
        fail("candidate write access exposure detected")
    if boundary.get("verified_artifact_lease") is not True:
        fail("verified artifact lease evidence missing")

    aggregate = evidence.get("aggregate", {})
    if aggregate.get("gate") != automation.get("aggregate_gate"):
        fail("aggregate gate mismatch")
    if aggregate.get("status") != "PASS":
        fail("aggregate gate did not pass")
    if aggregate.get("total_cases") != sum(check["cases"] for check in checks.values()):
        fail("aggregate case count mismatch")

    print(
        "Update candidate evidence validation PASS "
        f"checks={len(required_checks)} states={len(required_states)} "
        f"cases={aggregate['total_cases']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
