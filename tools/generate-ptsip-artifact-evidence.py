from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"Unable to read JSON {path}: {exc}") from exc


def write_json(path: Path, payload: Any) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    path.write_bytes(raw)
    return raw


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate revision-bound ptsip-artifact-evidence/v1 for the public Registry Product surface."
    )
    parser.add_argument("--validation", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--tracked-content-sha256", required=True)
    parser.add_argument("--component", action="append", required=True)
    args = parser.parse_args()

    validation = load_json(Path(args.validation).resolve())
    if validation.get("valid") is not True:
        raise SystemExit("PTSIP validation payload is not valid.")

    details = validation.get("details")
    if not isinstance(details, dict):
        raise SystemExit("PTSIP validation payload has no details object.")
    partition = details.get("component_partition")
    if not isinstance(partition, dict):
        raise SystemExit("PTSIP validation payload has no component_partition evidence.")

    conflicts = partition.get("conflicts", [])
    unassigned = partition.get("unassigned_files", [])
    scan_errors = partition.get("scan_errors", [])
    if conflicts or unassigned or scan_errors:
        raise SystemExit(
            "Cannot assert complete Product Artifact evidence while component partition has "
            f"conflicts={len(conflicts)} unassigned={len(unassigned)} scan_errors={len(scan_errors)}."
        )

    requested = sorted(set(args.component))
    assignments = partition.get("assignments", [])
    if not isinstance(assignments, list):
        raise SystemExit("PTSIP component_partition.assignments is not a list.")

    selected_paths: set[str] = set()
    seen_components: set[str] = set()
    for assignment in assignments:
        if not isinstance(assignment, dict):
            continue
        component_id = assignment.get("component_id")
        path = assignment.get("path")
        if component_id in requested and isinstance(path, str) and path:
            selected_paths.add(path)
            seen_components.add(str(component_id))

    missing = sorted(set(requested) - seen_components)
    if missing:
        raise SystemExit("Requested Product Artifact component(s) have no assigned paths: " + ", ".join(missing))
    if not selected_paths:
        raise SystemExit("No Product Artifact paths were selected.")

    revision = args.revision.strip().lower()
    tracked = args.tracked_content_sha256.strip().lower()
    if len(revision) < 40 or any(ch not in "0123456789abcdef" for ch in revision):
        raise SystemExit("--revision must be a lowercase hexadecimal Git object id of at least 40 characters.")
    if len(tracked) != 64 or any(ch not in "0123456789abcdef" for ch in tracked):
        raise SystemExit("--tracked-content-sha256 must be lowercase SHA-256 hex.")

    artifact_id = f"sctool-registry-public-surface-{revision[:16]}"
    evidence = {
        "format": "ptsip-artifact-evidence/v1",
        "artifact_id": artifact_id,
        "classification": "PRODUCT",
        "producer_component": None,
        "artifact_type": "public-registry-source-surface",
        "shipping_scope": "public-registry-distribution-metadata",
        "contents": {
            "paths": sorted(selected_paths),
            "components": requested,
            "complete": True,
        },
        "provenance": "OBSERVED",
        "evidence_ids": [f"git-tree:{revision}"],
    }

    out = Path(args.out).resolve()
    raw = write_json(out, evidence)
    evidence_sha256 = hashlib.sha256(raw).hexdigest()
    binding = {
        "format": "ptsip-artifact-evidence-binding/v1",
        "artifact_sha256": evidence_sha256,
        "subject": {
            "repository": args.repository,
            "revision": revision,
            "tracked_content_sha256": tracked,
        },
    }
    binding_path = Path(str(out) + ".binding.json")
    write_json(binding_path, binding)
    print(
        f"PTSIP Product Artifact evidence written artifact_id={artifact_id} "
        f"paths={len(selected_paths)} sha256={evidence_sha256}"
    )


if __name__ == "__main__":
    main()
