from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "tools" / "validate-registry.py"

spec = importlib.util.spec_from_file_location("registry_validation", VALIDATOR_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("Unable to load tools/validate-registry.py")
registry_validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry_validation)

PACKAGE_ID = "example-tool"
LABEL = "fixture"
POLICY = registry_validation.load_json(ROOT / "policy" / "registry-policy.json")


def artifact(*, cache: bool = True, redistribution: bool = True) -> dict[str, Any]:
    delivery: dict[str, Any] = {
        "type": "github-release-asset",
        "access": {"contract": "registry-public-integrity-v1"},
        "origin": {
            "repository": "ExamplePublisher/example-tool",
            "releaseId": 55,
            "assetId": 101,
        },
    }
    if cache:
        delivery["cache"] = {
            "repository": "Simple-Connection/sctool-artifacts",
            "releaseId": 77,
            "assetId": 201,
        }
    return {
        "target": {"platform": "win", "arch": "x64"},
        "content": {
            "filename": "example-tool-1.2.3-win-x64.sctool",
            "sha256": "a" * 64,
            "size": 123456,
        },
        "delivery": delivery,
        "publication": {
            "marketplace": True,
            "publicRedistribution": redistribution,
        },
        "publishedAt": "2026-08-28T00:00:00Z",
        "contract": {"sctoolSpecVersion": "1.0.0"},
        "signature": {
            "algorithm": "ed25519",
            "keyId": "publisher-key-1",
            "scope": "sctool-submission-v2",
            "submissionId": "submission-000001",
            "submittedAt": "2026-08-28T00:00:00Z",
            "sdkVersion": "0.2.0",
            "value": "QUFBQUFBQUFBQUFBQUFBQQ==",
        },
    }


def valid_descriptor() -> dict[str, Any]:
    return {
        "schemaVersion": "3.0.0",
        "id": PACKAGE_ID,
        "publisher": "ExamplePublisher",
        "defaultChannel": "stable",
        "channels": {"stable": "1.2.3"},
        "versions": {
            "1.2.3": {
                "artifacts": {
                    "win-x64": artifact(),
                }
            }
        },
    }


def current_artifact(payload: dict[str, Any]) -> dict[str, Any]:
    return payload["versions"]["1.2.3"]["artifacts"]["win-x64"]


def schema_errors(payload: dict[str, Any]) -> list[str]:
    return registry_validation.schema_errors("package.schema.json", payload, LABEL)


def consistency_errors(payload: dict[str, Any]) -> list[str]:
    return registry_validation.package_consistency_errors(payload, PACKAGE_ID, LABEL, POLICY)


def expect_valid(name: str, payload: dict[str, Any]) -> None:
    errors = schema_errors(payload) + consistency_errors(payload)
    if errors:
        raise AssertionError(f"{name} expected PASS but failed:\n" + "\n".join(errors))


def expect_invalid(name: str, mutate: Callable[[dict[str, Any]], None], *, layer: str) -> None:
    payload = valid_descriptor()
    mutate(payload)
    errors = schema_errors(payload) if layer == "schema" else consistency_errors(payload)
    if not errors:
        raise AssertionError(f"{name} expected {layer} failure but passed")


def main() -> None:
    registry_validation.Draft202012Validator.check_schema(
        registry_validation.load_json(ROOT / "schemas" / "package.schema.json")
    )

    expect_valid("current cache with signed redistribution consent", valid_descriptor())

    origin_only = valid_descriptor()
    current_artifact(origin_only)["delivery"].pop("cache")
    current_artifact(origin_only)["publication"]["publicRedistribution"] = False
    expect_valid("current origin-only without redistribution consent", origin_only)

    schema_cases: list[tuple[str, Callable[[dict[str, Any]], None]]] = [
        ("legacy schema", lambda p: p.__setitem__("schemaVersion", "2.0.0")),
        ("missing origin", lambda p: current_artifact(p)["delivery"].pop("origin")),
        ("missing origin releaseId", lambda p: current_artifact(p)["delivery"]["origin"].pop("releaseId")),
        ("missing origin assetId", lambda p: current_artifact(p)["delivery"]["origin"].pop("assetId")),
        ("legacy signature scope", lambda p: current_artifact(p)["signature"].__setitem__("scope", "sctool-submission-v1")),
        ("credential injection", lambda p: current_artifact(p)["delivery"]["access"].__setitem__("token", "secret")),
    ]

    consistency_cases: list[tuple[str, Callable[[dict[str, Any]], None]]] = [
        ("cache repository mismatch", lambda p: current_artifact(p)["delivery"]["cache"].__setitem__("repository", "OtherOrg/cache")),
        ("cache without redistribution consent", lambda p: current_artifact(p)["publication"].__setitem__("publicRedistribution", False)),
        ("target key mismatch", lambda p: current_artifact(p)["target"].__setitem__("arch", "arm64")),
    ]

    def historical_cache(payload: dict[str, Any]) -> None:
        payload["versions"]["1.2.2"] = {"artifacts": {"win-x64": copy.deepcopy(artifact())}}

    consistency_cases.append(("historical cache forbidden", historical_cache))

    for name, mutate in schema_cases:
        expect_invalid(name, mutate, layer="schema")
    for name, mutate in consistency_cases:
        expect_invalid(name, mutate, layer="consistency")

    print(f"Package descriptor v3 custody validation PASS cases={2 + len(schema_cases) + len(consistency_cases)}")


if __name__ == "__main__":
    main()
