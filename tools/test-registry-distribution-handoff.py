from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVISION = "a" * 40
RAW_ARTIFACT_DIGEST = "0123456789abcdef" * 4


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="registry-handoff-test-") as temporary:
        temp = Path(temporary)
        site = temp / "site"
        snapshot_path = f"snapshots/{REVISION}.json"

        snapshot = {
            "schemaVersion": "1.0.0",
            "sequence": 7,
            "revision": REVISION,
            "generatedAt": "2026-09-13T00:00:00Z",
            "source": {
                "repository": "Simple-Connection/sctool-registry",
                "commit": REVISION,
            },
            "registrySha256": "0" * 64,
            "packages": {},
            "publishers": {},
            "marketplaceProfiles": {},
        }
        snapshot_bytes = (json.dumps(snapshot, indent=2) + "\n").encode("utf-8")
        (site / "snapshots").mkdir(parents=True, exist_ok=True)
        (site / snapshot_path).write_bytes(snapshot_bytes)

        trust = {
            "schemaVersion": "1.0.0",
            "signed": {
                "scope": "sctool-registry-trust-v1",
                "sequence": 3,
                "issuedAt": "2026-09-13T00:00:00Z",
                "rootKeyId": "registry-root-test",
                "distributionKeys": [],
            },
            "proof": {
                "algorithm": "ed25519",
                "scope": "sctool-registry-trust-v1",
                "keyId": "registry-root-test",
                "signature": "fixture-signature",
            },
        }
        head = {
            "schemaVersion": "1.0.0",
            "signed": {
                "scope": "sctool-registry-head-v1",
                "sequence": 7,
                "revision": REVISION,
                "issuedAt": "2026-09-13T00:00:00Z",
                "trustSequence": 3,
                "signingKeyId": "registry-distribution-test",
                "snapshot": {
                    "path": snapshot_path,
                    "sha256": hashlib.sha256(snapshot_bytes).hexdigest(),
                    "size": len(snapshot_bytes),
                },
            },
            "proof": {
                "algorithm": "ed25519",
                "scope": "sctool-registry-head-v1",
                "keyId": "registry-distribution-test",
                "signature": "fixture-signature",
            },
        }
        write_json(site / "trust.json", trust)
        write_json(site / "registry-head.json", head)

        evidence_path = temp / "registry-distribution-handoff.json"
        subprocess.run(
            [
                "node",
                "tools/generate-registry-distribution-handoff.mjs",
                "--site",
                str(site),
                "--out",
                str(evidence_path),
                "--repository",
                "Simple-Connection/sctool-registry",
                "--workflow",
                ".github/workflows/pages.yml",
                "--run-id",
                "12345",
                "--run-attempt",
                "1",
                "--source-revision",
                REVISION,
                "--source-ref",
                "refs/heads/main",
                "--artifact-name",
                f"registry-signed-distribution-{REVISION}",
                "--artifact-id",
                "67890",
                "--artifact-digest",
                RAW_ARTIFACT_DIGEST,
            ],
            cwd=ROOT,
            check=True,
        )

        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        assert evidence["artifact"]["digest"] == f"sha256:{RAW_ARTIFACT_DIGEST}"
        assert evidence["producer"]["sourceRevision"] == REVISION
        assert evidence["registry"]["snapshotPath"] == snapshot_path

        subprocess.run(
            [
                sys.executable,
                "tools/validate-registry-distribution-handoff.py",
                "--contract",
                "docs/REGISTRY_SIGNED_DISTRIBUTION_HANDOFF_V1.yaml",
                "--schema",
                "tools/policy_automatic_engine/schemas/registry/registry-distribution-handoff.schema.json",
                "--evidence",
                str(evidence_path),
                "--site",
                str(site),
            ],
            cwd=ROOT,
            check=True,
        )

        unexpected = site / "unexpected.json"
        unexpected.write_text("{}\n", encoding="utf-8")
        failed = subprocess.run(
            [
                "node",
                "tools/generate-registry-distribution-handoff.mjs",
                "--site",
                str(site),
                "--out",
                str(temp / "should-not-exist.json"),
                "--repository",
                "Simple-Connection/sctool-registry",
                "--workflow",
                ".github/workflows/pages.yml",
                "--run-id",
                "12345",
                "--run-attempt",
                "1",
                "--source-revision",
                REVISION,
                "--source-ref",
                "refs/heads/main",
                "--artifact-name",
                f"registry-signed-distribution-{REVISION}",
                "--artifact-id",
                "67890",
                "--artifact-digest",
                RAW_ARTIFACT_DIGEST,
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if failed.returncode == 0:
            raise SystemExit("Expected exact-file-set rejection for unexpected distribution file.")

    print("Registry signed distribution handoff tooling test PASS")


if __name__ == "__main__":
    main()
