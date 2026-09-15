#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
RESOLVER = ROOT / "docs" / "governance" / "agent-entry.py"


def resolve(*args: str) -> dict:
    result = subprocess.run(
        [sys.executable, str(RESOLVER), *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def main() -> int:
    update = resolve("--task-class", "REGISTRY_CLIENT_SDK_UPDATE")
    assert update["task_classes"] == ["REGISTRY_CLIENT_SDK_UPDATE"]
    assert update["read_set"] == [
        "docs/agent/entries/registry-client-sdk.md",
        "docs/UPDATE_CANDIDATE_V1.yaml",
        "docs/STAGED_ARTIFACT_LIFECYCLE_V1.yaml",
        "docs/SIMPLE_CONNECTION_INSTALL_TRANSACTION_V1.yaml",
    ]
    assert "docs/agent/entries/authoring-sdk.md" not in update["read_set"]
    assert "docs/ver1.0.3/1.0.3_Improvement_plan.yaml" not in update["read_set"]

    policy = resolve("--task-class", "POLICY")
    assert policy["read_set"] == [
        "docs/agent/entries/policy.md",
        "docs/policy/index.yaml",
        "docs/index.yaml",
    ]

    by_path = resolve("--path", "docs/UPDATE_CANDIDATE_V1.yaml")
    assert by_path["task_classes"] == ["REGISTRY_CLIENT_SDK_UPDATE"]
    assert by_path["read_set"] == update["read_set"]

    combined = resolve(
        "--task-class", "REGISTRY_CLIENT_SDK_UPDATE",
        "--task-class", "RESPONSIBILITY",
    )
    assert combined["task_classes"] == [
        "REGISTRY_CLIENT_SDK_UPDATE",
        "RESPONSIBILITY",
    ]
    assert combined["read_set"] == [
        "docs/agent/entries/registry-client-sdk.md",
        "docs/agent/entries/responsibility.md",
        "docs/UPDATE_CANDIDATE_V1.yaml",
        "docs/STAGED_ARTIFACT_LIFECYCLE_V1.yaml",
        "docs/SIMPLE_CONNECTION_INSTALL_TRANSACTION_V1.yaml",
        "docs/responsibility/index.yaml",
        "docs/index.yaml",
    ]

    print("Agent entry routing PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
