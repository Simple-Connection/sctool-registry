from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def list_files(root: Path) -> list[str]:
    files: list[str] = []
    for path in root.rglob("*"):
        if path.is_symlink():
            raise SystemExit(f"Symbolic links are forbidden in signed distribution: {path}")
        if path.is_file():
            files.append(path.relative_to(root).as_posix())
    return sorted(files)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", default="docs/REGISTRY_SIGNED_DISTRIBUTION_HANDOFF_V1.yaml")
    parser.add_argument("--schema", default="tools/policy_automatic_engine/schemas/registry/registry-distribution-handoff.schema.json")
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--site", required=True)
    args = parser.parse_args()

    contract = yaml.safe_load(Path(args.contract).read_text(encoding="utf-8"))
    schema = load_json(Path(args.schema))
    evidence = load_json(Path(args.evidence))
    site = Path(args.site).resolve()

    errors = sorted(
        Draft202012Validator(schema).iter_errors(evidence),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        rendered = []
        for error in errors:
            location = ".".join(str(part) for part in error.absolute_path) or "<root>"
            rendered.append(f"{location}: {error.message}")
        raise SystemExit("\n".join(rendered))

    if contract.get("contract_id") != "REGISTRY_SIGNED_DISTRIBUTION_HANDOFF_V1":
        raise SystemExit("Unexpected signed distribution handoff contract id.")
    if evidence["producer"]["repository"] != contract["producer"]["repository"]:
        raise SystemExit("Producer repository does not match handoff contract.")
    if evidence["producer"]["workflow"] != contract["producer"]["workflow"]:
        raise SystemExit("Producer workflow does not match handoff contract.")

    revision = evidence["producer"]["sourceRevision"]
    expected_name = contract["bundle"]["name_format"].replace("{revision}", revision)
    if evidence["artifact"]["name"] != expected_name:
        raise SystemExit("Artifact name does not bind the exact source revision.")

    trust = load_json(site / contract["bundle"]["files"]["trust"]["path"])
    head = load_json(site / contract["bundle"]["files"]["head"]["path"])
    snapshot_path = head["signed"]["snapshot"]["path"]
    expected_snapshot_path = contract["bundle"]["files"]["snapshot"]["path_format"].replace(
        "{revision}", revision
    )
    if snapshot_path != expected_snapshot_path:
        raise SystemExit("Snapshot path does not bind the exact source revision.")

    expected_files = sorted(
        [
            contract["bundle"]["files"]["trust"]["path"],
            contract["bundle"]["files"]["head"]["path"],
            snapshot_path,
        ]
    )
    actual_files = list_files(site)
    if actual_files != expected_files:
        raise SystemExit(
            f"Signed distribution file set mismatch expected={expected_files} actual={actual_files}"
        )

    evidence_files = {entry["path"]: entry for entry in evidence["files"]}
    if sorted(evidence_files) != expected_files:
        raise SystemExit("Handoff evidence file set does not match signed distribution.")

    for relative in expected_files:
        path = site / relative
        expected = evidence_files[relative]
        if path.stat().st_size != expected["size"]:
            raise SystemExit(f"Handoff evidence size mismatch: {relative}")
        if sha256(path) != expected["sha256"]:
            raise SystemExit(f"Handoff evidence SHA-256 mismatch: {relative}")

    snapshot = load_json(site / snapshot_path)
    registry = evidence["registry"]
    if registry["revision"] != revision or head["signed"]["revision"] != revision:
        raise SystemExit("Registry head revision does not match producer source revision.")
    if snapshot.get("revision") != revision:
        raise SystemExit("Snapshot revision does not match producer source revision.")
    if snapshot.get("source", {}).get("repository") != contract["consumer_gates"]["source_repository"]:
        raise SystemExit("Snapshot source repository mismatch.")
    if snapshot.get("source", {}).get("commit") != revision:
        raise SystemExit("Snapshot source commit mismatch.")
    if head["signed"]["trustSequence"] != trust["signed"]["sequence"]:
        raise SystemExit("Head trustSequence does not match trust sequence.")
    if registry["trustSequence"] != trust["signed"]["sequence"]:
        raise SystemExit("Evidence trust sequence mismatch.")
    if registry["sequence"] != head["signed"]["sequence"]:
        raise SystemExit("Evidence Registry sequence mismatch.")
    if registry["rootKeyId"] != trust["signed"]["rootKeyId"]:
        raise SystemExit("Evidence Root key id mismatch.")
    if registry["distributionKeyId"] != head["signed"]["signingKeyId"]:
        raise SystemExit("Evidence Distribution key id mismatch.")
    if registry["snapshotPath"] != snapshot_path:
        raise SystemExit("Evidence snapshot path mismatch.")

    snapshot_bytes = (site / snapshot_path).read_bytes()
    if len(snapshot_bytes) != head["signed"]["snapshot"]["size"]:
        raise SystemExit("Snapshot size does not match signed head.")
    if hashlib.sha256(snapshot_bytes).hexdigest() != head["signed"]["snapshot"]["sha256"]:
        raise SystemExit("Snapshot digest does not match signed head.")

    print(
        "Registry signed distribution handoff validation PASS "
        f"run_id={evidence['producer']['runId']} "
        f"artifact_id={evidence['artifact']['id']} "
        f"revision={revision}"
    )


if __name__ == "__main__":
    main()
