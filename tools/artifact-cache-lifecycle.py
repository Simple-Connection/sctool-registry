from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "tools" / "validate-registry.py"

spec = importlib.util.spec_from_file_location("registry_validation", VALIDATOR_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("Unable to load tools/validate-registry.py")
registry_validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry_validation)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def current_version(descriptor: dict[str, Any]) -> str:
    return descriptor["channels"][descriptor["defaultChannel"]]


def validate_descriptor(descriptor: dict[str, Any], label: str, policy: dict[str, Any]) -> None:
    package_id = descriptor.get("id")
    errors = registry_validation.schema_errors("package.schema.json", descriptor, label)
    if isinstance(package_id, str):
        errors += registry_validation.package_consistency_errors(descriptor, package_id, label, policy)
    if errors:
        raise ValueError("\n".join(errors))


def cache_key(locator: dict[str, Any]) -> tuple[str, int, int]:
    return (locator["repository"], locator["releaseId"], locator["assetId"])


def build_plan(
    previous: dict[str, Any] | None,
    next_descriptor: dict[str, Any],
    policy: dict[str, Any],
) -> dict[str, Any]:
    validate_descriptor(next_descriptor, "next", policy)
    if previous is not None:
        validate_descriptor(previous, "previous", policy)
        if previous["id"] != next_descriptor["id"]:
            raise ValueError("package identity cannot change across cache lifecycle transition")

    package_id = next_descriptor["id"]
    next_current = current_version(next_descriptor)
    previous_current = current_version(previous) if previous is not None else None

    promotions: list[dict[str, Any]] = []
    verify_cache: list[dict[str, Any]] = []
    evict_after_publication: list[dict[str, Any]] = []

    next_artifacts = next_descriptor["versions"][next_current]["artifacts"]
    next_cache_keys: set[tuple[str, int, int]] = set()

    for target_key, artifact in sorted(next_artifacts.items()):
        delivery = artifact["delivery"]
        cache = delivery.get("cache")
        consent = artifact["publication"]["publicRedistribution"] is True
        base = {
            "packageId": package_id,
            "version": next_current,
            "targetKey": target_key,
            "content": artifact["content"],
            "origin": delivery["origin"],
        }
        if cache is not None:
            next_cache_keys.add(cache_key(cache))
            verify_cache.append({**base, "cache": cache})
        elif consent:
            promotions.append(base)

    if previous is not None:
        previous_artifacts = previous["versions"][previous_current]["artifacts"]
        for target_key, artifact in sorted(previous_artifacts.items()):
            cache = artifact["delivery"].get("cache")
            if cache is None:
                continue
            if cache_key(cache) in next_cache_keys:
                continue
            evict_after_publication.append({
                "packageId": package_id,
                "version": previous_current,
                "targetKey": target_key,
                "cache": cache,
            })

    return {
        "schema": "artifact-cache-lifecycle-plan/v1",
        "packageId": package_id,
        "previousCurrentVersion": previous_current,
        "nextCurrentVersion": next_current,
        "actions": {
            "promote": promotions,
            "verifyCache": verify_cache,
            "evictAfterPublication": evict_after_publication,
        },
    }


def fixture(version: str, *, cache: bool, redistribution: bool = True) -> dict[str, Any]:
    delivery: dict[str, Any] = {
        "type": "github-release-asset",
        "access": {"contract": "registry-public-integrity-v1"},
        "origin": {
            "repository": "ExamplePublisher/example-tool",
            "releaseId": 100 if version == "1.0.0" else 200,
            "assetId": 101 if version == "1.0.0" else 201,
        },
    }
    if cache:
        delivery["cache"] = {
            "repository": "Simple-Connection/sctool-artifacts",
            "releaseId": 300 if version == "1.0.0" else 400,
            "assetId": 301 if version == "1.0.0" else 401,
        }
    artifact = {
        "target": {"platform": "win", "arch": "x64"},
        "content": {"filename": f"example-{version}.sctool", "sha256": "a" * 64, "size": 10},
        "delivery": delivery,
        "publication": {"marketplace": True, "publicRedistribution": redistribution},
        "publishedAt": "2026-09-13T00:00:00Z",
        "contract": {"sctoolSpecVersion": "1.0.0"},
        "signature": {
            "algorithm": "ed25519",
            "keyId": "publisher-key-1",
            "scope": "sctool-submission-v2",
            "submissionId": f"submission-{version}-0001",
            "submittedAt": "2026-09-13T00:00:00Z",
            "sdkVersion": "0.2.0",
            "value": "QUFBQUFBQUFBQUFBQUFBQQ==",
        },
    }
    return {
        "schemaVersion": "3.0.0",
        "id": "example-tool",
        "publisher": "ExamplePublisher",
        "defaultChannel": "stable",
        "channels": {"stable": version},
        "versions": {version: {"artifacts": {"win-x64": artifact}}},
    }


def self_test(policy: dict[str, Any]) -> None:
    previous = fixture("1.0.0", cache=True)
    next_without_cache = fixture("2.0.0", cache=False)
    plan = build_plan(previous, next_without_cache, policy)
    assert len(plan["actions"]["promote"]) == 1
    assert len(plan["actions"]["evictAfterPublication"]) == 1
    assert len(plan["actions"]["verifyCache"]) == 0

    next_with_cache = fixture("2.0.0", cache=True)
    plan = build_plan(previous, next_with_cache, policy)
    assert len(plan["actions"]["promote"]) == 0
    assert len(plan["actions"]["verifyCache"]) == 1
    assert len(plan["actions"]["evictAfterPublication"]) == 1

    no_consent = fixture("2.0.0", cache=False, redistribution=False)
    plan = build_plan(previous, no_consent, policy)
    assert len(plan["actions"]["promote"]) == 0

    invalid = fixture("2.0.0", cache=True, redistribution=False)
    try:
        build_plan(previous, invalid, policy)
    except ValueError:
        pass
    else:
        raise AssertionError("cache without signed redistribution consent must fail")

    print("Artifact cache lifecycle planner PASS cases=4")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--previous")
    parser.add_argument("--next")
    parser.add_argument("--out")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    policy = load_json(ROOT / "policy" / "registry-policy.json")
    if args.self_test:
        self_test(policy)
        return

    if not args.next or not args.out:
        raise SystemExit("--next and --out are required unless --self-test is used")

    previous = load_json(Path(args.previous)) if args.previous else None
    next_descriptor = load_json(Path(args.next))
    plan = build_plan(previous, next_descriptor, policy)
    Path(args.out).write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
