#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
RESOLVER = ROOT / "tools" / "policy_automatic_engine" / "governance" / "agent-entry.py"


def run(*args: str) -> dict:
    result = subprocess.run([sys.executable, str(RESOLVER), *args], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def main() -> int:
    catalog = run("--catalog")
    assert "REGISTRY_CLIENT_SDK_UPDATE" in catalog
    assert "POLICY" in catalog

    governance = run("--task-class", "GOVERNANCE")
    assert governance["commands"]["GOVERNANCE_VALIDATE"]["argv"] == [
        "python", "tools/policy_automatic_engine/governance/validate.py", "--root", ".",
    ]
    assert governance["commands"]["AGENT_ENTRY_TEST"]["argv"] == [
        "python", "tools/policy_automatic_engine/governance/tests/test-agent-entry.py",
    ]

    ptsip = run("--task-class", "PTSIP")
    assert ptsip["commands"]["PTSIP_VALIDATE"]["argv"] == ["ptsip", "validate", "."]

    update = run("--task-class", "REGISTRY_CLIENT_SDK_UPDATE")
    assert update["read_set"] == [
        "docs/UPDATE_CANDIDATE_V1.yaml",
        "docs/STAGED_ARTIFACT_LIFECYCLE_V1.yaml",
        "docs/SIMPLE_CONNECTION_INSTALL_TRANSACTION_V1.yaml",
    ]
    assert "PRODUCT_PERSISTENT_INSTALL_OWNERSHIP" in update["forbidden"]
    assert "PRODUCT_PERSISTENT_INSTALL_STATE" in update["excluded_capabilities"]
    assert not any(path.startswith("docs/agent/") for path in update["read_set"])
    assert not any(path.startswith("docs/ver") for path in update["read_set"])

    by_path = run("--path", "docs/UPDATE_CANDIDATE_V1.yaml")
    assert by_path["task_classes"] == ["REGISTRY_CLIENT_SDK_UPDATE"]
    assert by_path["read_set"] == update["read_set"]

    policy = run("--task-class", "POLICY")
    assert policy["read_set"] == ["docs/policy/index.yaml", "docs/index.yaml"]
    assert policy["conditional_task_classes"]["RESPONSIBILITY"] == "POLICY_CHANGES_AUTHORITY_BOUNDARY"

    combined = run("--task-class", "REGISTRY_CLIENT_SDK_UPDATE", "--task-class", "RESPONSIBILITY")
    assert combined["read_set"] == [
        "docs/UPDATE_CANDIDATE_V1.yaml",
        "docs/STAGED_ARTIFACT_LIFECYCLE_V1.yaml",
        "docs/SIMPLE_CONNECTION_INSTALL_TRANSACTION_V1.yaml",
        "docs/responsibility/index.yaml",
        "docs/index.yaml",
    ]

    entry_root = ROOT / "docs" / "agent" / "entries"
    assert not entry_root.exists() or not any(p.is_file() for p in entry_root.rglob("*"))

    print("Agent entry routing PASS inline_machine_directives=true direct_entry_reads=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
