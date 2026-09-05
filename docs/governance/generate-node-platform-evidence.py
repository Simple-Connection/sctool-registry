#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from ptsip.inspection.dependencies_030 import scan_dependency_edges
from ptsip.model import EvidenceNodeScope, ResolutionStatus


PRODUCER_ID = "sctool-registry-node-platform-observer"
PRODUCER_VERSION = "1"


def load_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("validation document root must be an object")
    return value


def node_builtin_modules() -> set[str]:
    script = (
        "const { builtinModules } = require('node:module');"
        "process.stdout.write(JSON.stringify(builtinModules));"
    )
    result = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    if not isinstance(payload, list):
        raise ValueError("Node builtinModules result must be an array")
    modules = {str(item) for item in payload}
    modules.update(f"node:{item}" for item in list(modules) if not item.startswith("node:"))
    return modules


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validation", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()

    validation = load_json(Path(args.validation))
    if validation.get("valid") is not True:
        raise ValueError("PTSIP validation payload must be valid before platform evidence is generated")

    scan = scan_dependency_edges(Path("."))
    if scan.issues:
        raise ValueError(
            "PTSIP dependency scan has unresolved collection issues: "
            + "; ".join(f"{item.adapter}:{item.path}:{item.message}" for item in scan.issues)
        )

    builtins = node_builtin_modules()
    evidence: list[dict[str, object]] = []
    unrecognized: list[str] = []

    for edge in scan.edges:
        if edge.adapter != "javascript-typescript":
            continue
        if edge.resolution != ResolutionStatus.UNRESOLVED:
            continue
        if edge.target_scope != EvidenceNodeScope.UNRESOLVED_TARGET:
            continue
        target = edge.target
        if not target.startswith("node:"):
            continue

        if target not in builtins and target.removeprefix("node:") not in builtins:
            unrecognized.append(target)
            continue

        evidence.append(
            {
                "kind": "dependency",
                "evidence_id": f"node-platform:{edge.source}:{edge.line or 0}:{target}",
                "source": edge.source,
                "target": target,
                "relationship_type": edge.edge_type.value,
                "phase": edge.phase.value,
                "resolution": "EXTERNAL",
                "target_scope": "PLATFORM",
                "provenance": "OBSERVED",
            }
        )

    if unrecognized:
        raise ValueError(
            "unrecognized node: imports cannot be classified as PLATFORM: "
            + ",".join(sorted(set(unrecognized)))
        )

    evidence.sort(key=lambda item: (str(item["source"]), str(item["target"]), str(item["evidence_id"])))
    output = {
        "format": "ptsip-external-evidence/v1",
        "producer": {"id": PRODUCER_ID, "version": PRODUCER_VERSION},
        "subject": {
            "repository": args.repository,
            "revision": args.revision,
        },
        "evidence": evidence,
    }
    Path(args.out).write_text(
        json.dumps(output, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"PTSIP Node platform evidence PASS edges={len(evidence)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
