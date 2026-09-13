from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "tools" / "validate-registry.py"
spec = importlib.util.spec_from_file_location("registry_validation", VALIDATOR_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("Unable to load tools/validate-registry.py")
registry_validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry_validation)


def valid_submission() -> dict:
    return {
        "schemaVersion": "2.0.0",
        "submission": {"id": "submission-000001", "createdAt": "2026-09-13T00:00:00Z"},
        "package": {"id": "example-tool", "version": "1.2.3"},
        "target": {"platform": "win", "arch": "x64"},
        "artifact": {"filename": "example.sctool", "sha256": "a" * 64, "size": 123},
        "origin": {
            "type": "github-release-asset",
            "repository": "ExamplePublisher/example-tool",
            "releaseId": 55,
            "assetId": 101,
        },
        "publication": {"marketplace": True, "publicRedistribution": True},
        "contract": {"sctoolSpecVersion": "1.0.0", "sdkVersion": "0.2.0"},
        "publisher": {"id": "ExamplePublisher", "keyId": "publisher-key-1"},
        "proof": {
            "algorithm": "ed25519",
            "scope": "sctool-submission-v2",
            "signature": "QUFBQUFBQUFBQUFBQUFBQQ==",
        },
    }


def errors(payload: dict) -> list[str]:
    return registry_validation.schema_errors("submission.schema.json", payload, "submission")


def require_invalid(payload: dict, label: str) -> None:
    if not errors(payload):
        raise AssertionError(f"{label} expected failure")


def main() -> None:
    base = valid_submission()
    if errors(base):
        raise AssertionError("\n".join(errors(base)))

    no_redistribution = copy.deepcopy(base)
    no_redistribution["publication"]["publicRedistribution"] = False
    if errors(no_redistribution):
        raise AssertionError("public redistribution may be declined while marketplace intent remains explicit")

    legacy = copy.deepcopy(base)
    legacy["schemaVersion"] = "1.0.0"
    require_invalid(legacy, "legacy schema")

    missing_origin = copy.deepcopy(base)
    missing_origin.pop("origin")
    require_invalid(missing_origin, "origin required")

    missing_release = copy.deepcopy(base)
    missing_release["origin"].pop("releaseId")
    require_invalid(missing_release, "releaseId required")

    missing_market = copy.deepcopy(base)
    missing_market["publication"]["marketplace"] = False
    require_invalid(missing_market, "explicit marketplace intent required")

    legacy_scope = copy.deepcopy(base)
    legacy_scope["proof"]["scope"] = "sctool-submission-v1"
    require_invalid(legacy_scope, "v2 signature scope required")

    print("Submission v2 origin and publication intent validation PASS cases=7")


if __name__ == "__main__":
    main()
