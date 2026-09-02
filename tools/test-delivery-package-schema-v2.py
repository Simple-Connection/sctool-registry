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


def valid_descriptor() -> dict[str, Any]:
    return {
        "schemaVersion": "2.0.0",
        "id": PACKAGE_ID,
        "publisher": "ExamplePublisher",
        "defaultChannel": "stable",
        "channels": {"stable": "1.2.3"},
        "versions": {
            "1.2.3": {
                "artifacts": {
                    "win-x64": {
                        "target": {"platform": "win", "arch": "x64"},
                        "content": {
                            "filename": "example-tool-1.2.3-win-x64.sctool",
                            "sha256": "a" * 64,
                            "size": 123456,
                        },
                        "delivery": {
                            "type": "github-release-asset",
                            "access": {"contract": "registry-access-v1"},
                            "locator": {
                                "repository": "Simple-Connection/sctool-artifacts",
                                "assetId": 123456789,
                            },
                        },
                        "publishedAt": "2026-08-28T00:00:00Z",
                        "contract": {"sctoolSpecVersion": "1.0.0"},
                        "signature": {
                            "algorithm": "ed25519",
                            "keyId": "publisher-key-1",
                            "scope": "sctool-submission-v1",
                            "submissionId": "submission-000001",
                            "submittedAt": "2026-08-28T00:00:00Z",
                            "sdkVersion": "1.0.0",
                            "value": "QUFBQUFBQUFBQUFBQUFBQQ==",
                        },
                    }
                }
            }
        },
    }


def artifact(payload: dict[str, Any]) -> dict[str, Any]:
    return payload["versions"]["1.2.3"]["artifacts"]["win-x64"]


def schema_errors(payload: dict[str, Any]) -> list[str]:
    return registry_validation.schema_errors("package.schema.json", payload, LABEL)


def consistency_errors(payload: dict[str, Any]) -> list[str]:
    return registry_validation.package_consistency_errors(payload, PACKAGE_ID, LABEL, POLICY)


def expect_valid(name: str, payload: dict[str, Any]) -> None:
    errors = schema_errors(payload) + consistency_errors(payload)
    if errors:
        raise AssertionError(f"{name} expected PASS but failed:\n" + "\n".join(errors))


def expect_invalid(
    name: str,
    mutate: Callable[[dict[str, Any]], None],
    *,
    layer: str = "schema",
) -> None:
    payload = valid_descriptor()
    mutate(payload)
    errors = schema_errors(payload) if layer == "schema" else consistency_errors(payload)
    if not errors:
        raise AssertionError(f"{name} expected {layer} failure but passed")


def make_legacy_flat(payload: dict[str, Any]) -> None:
    current = artifact(payload)
    content = current.pop("content")
    current.pop("delivery")
    current["assetName"] = content["filename"]
    current["url"] = "https://example.invalid/example.sctool"
    current["sha256"] = content["sha256"]
    current["size"] = content["size"]


def set_unknown_type(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["type"] = "https-object"


def remove_repository(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["locator"].pop("repository")


def remove_asset_id(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["locator"].pop("assetId")


def set_zero_asset_id(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["locator"]["assetId"] = 0


def set_unsafe_asset_id(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["locator"]["assetId"] = 9007199254740992


def inject_token(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["access"]["token"] = "secret"


def inject_private_key(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["locator"]["privateKey"] = "secret"


def mismatch_target_key(payload: dict[str, Any]) -> None:
    artifacts = payload["versions"]["1.2.3"]["artifacts"]
    artifacts["linux-x64"] = artifacts.pop("win-x64")


def mismatch_repository_policy(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["locator"]["repository"] = "OtherOrg/other-artifacts"


def missing_default_channel(payload: dict[str, Any]) -> None:
    payload["defaultChannel"] = "beta"


def missing_channel_version(payload: dict[str, Any]) -> None:
    payload["channels"]["stable"] = "9.9.9"


def mismatched_access_contract(payload: dict[str, Any]) -> None:
    artifact(payload)["delivery"]["access"]["contract"] = "other-access-v1"


def main() -> None:
    registry_validation.Draft202012Validator.check_schema(
        registry_validation.load_json(ROOT / "schemas" / "package.schema.json")
    )

    expect_valid("valid github-release-asset descriptor", valid_descriptor())

    schema_cases = [
        ("legacy flat url-only artifact", make_legacy_flat),
        ("unknown delivery.type", set_unknown_type),
        ("missing locator.repository", remove_repository),
        ("missing locator.assetId", remove_asset_id),
        ("assetId zero", set_zero_asset_id),
        ("assetId exceeds safe integer", set_unsafe_asset_id),
        ("credential field injection", inject_token),
        ("private key field injection", inject_private_key),
        ("mismatched access contract", mismatched_access_contract),
    ]
    consistency_cases = [
        ("artifact map target mismatch", mismatch_target_key),
        ("repository policy mismatch", mismatch_repository_policy),
        ("defaultChannel missing from channels", missing_default_channel),
        ("channel points to missing version", missing_channel_version),
    ]

    for name, mutate in schema_cases:
        expect_invalid(name, mutate, layer="schema")
    for name, mutate in consistency_cases:
        expect_invalid(name, mutate, layer="consistency")

    total = 1 + len(schema_cases) + len(consistency_cases)
    print(f"Package descriptor v2 delivery validation PASS cases={total}")


if __name__ == "__main__":
    main()
