from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "schemas"
FORMAT_CHECKER = FormatChecker()


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"Invalid JSON {path.relative_to(ROOT)}: {exc}") from exc


def schema_errors(schema_name: str, payload: Any, label: str) -> list[str]:
    schema = load_json(SCHEMAS / schema_name)
    validator = Draft202012Validator(schema, format_checker=FORMAT_CHECKER)
    errors = sorted(
        validator.iter_errors(payload),
        key=lambda err: tuple(str(part) for part in err.absolute_path),
    )
    rendered: list[str] = []
    for err in errors:
        location = ".".join(str(part) for part in err.absolute_path) or "<root>"
        rendered.append(f"{label}:{location}: {err.message}")
    return rendered


def validate(schema_name: str, payload: Any, label: str) -> None:
    errors = schema_errors(schema_name, payload, label)
    if errors:
        raise SystemExit("\n".join(errors))


def package_consistency_errors(
    payload: dict[str, Any],
    package_id: str,
    label: str,
    policy: dict[str, Any],
) -> list[str]:
    errors: list[str] = []

    if payload.get("id") != package_id:
        errors.append(
            f"{label}:id: package identity mismatch: registry key {package_id!r} != descriptor id {payload.get('id')!r}"
        )

    channels = payload.get("channels", {})
    versions = payload.get("versions", {})
    default_channel = payload.get("defaultChannel")

    if isinstance(channels, dict) and isinstance(default_channel, str) and default_channel not in channels:
        errors.append(f"{label}:defaultChannel: channel {default_channel!r} does not exist in channels")

    if isinstance(channels, dict) and isinstance(versions, dict):
        for channel, version in sorted(channels.items()):
            if isinstance(version, str) and version not in versions:
                errors.append(f"{label}:channels.{channel}: version {version!r} does not exist in versions")

    artifact_policy = policy.get("artifact", {}).get("access", {})
    expected_backend = artifact_policy.get("backend")
    expected_repository = artifact_policy.get("repository")
    expected_access_contract = artifact_policy.get("contract")

    if isinstance(versions, dict):
        for version, version_entry in sorted(versions.items()):
            if not isinstance(version_entry, dict):
                continue
            artifacts = version_entry.get("artifacts", {})
            if not isinstance(artifacts, dict):
                continue
            for target_key, artifact in sorted(artifacts.items()):
                if not isinstance(artifact, dict):
                    continue

                target = artifact.get("target", {})
                if isinstance(target, dict):
                    platform = target.get("platform")
                    arch = target.get("arch")
                    if isinstance(platform, str) and isinstance(arch, str):
                        expected_target_key = f"{platform}-{arch}"
                        if target_key != expected_target_key:
                            errors.append(
                                f"{label}:versions.{version}.artifacts.{target_key}.target: "
                                f"artifact map key must equal {expected_target_key!r}"
                            )

                delivery = artifact.get("delivery", {})
                if not isinstance(delivery, dict):
                    continue

                delivery_type = delivery.get("type")
                if expected_backend is not None and delivery_type != expected_backend:
                    errors.append(
                        f"{label}:versions.{version}.artifacts.{target_key}.delivery.type: "
                        f"must match Registry policy backend {expected_backend!r}"
                    )

                access = delivery.get("access", {})
                if isinstance(access, dict):
                    access_contract = access.get("contract")
                    if expected_access_contract is not None and access_contract != expected_access_contract:
                        errors.append(
                            f"{label}:versions.{version}.artifacts.{target_key}.delivery.access.contract: "
                            f"must match Registry policy contract {expected_access_contract!r}"
                        )

                locator = delivery.get("locator", {})
                if isinstance(locator, dict):
                    repository = locator.get("repository")
                    if expected_repository is not None and repository != expected_repository:
                        errors.append(
                            f"{label}:versions.{version}.artifacts.{target_key}.delivery.locator.repository: "
                            f"must match Registry policy repository {expected_repository!r}"
                        )

    return errors


def validate_package_consistency(
    payload: dict[str, Any],
    package_id: str,
    label: str,
    policy: dict[str, Any],
) -> None:
    errors = package_consistency_errors(payload, package_id, label, policy)
    if errors:
        raise SystemExit("\n".join(errors))


def main() -> None:
    for schema_path in sorted(SCHEMAS.glob("*.schema.json")):
        Draft202012Validator.check_schema(load_json(schema_path))

    registry = load_json(ROOT / "registry.json")
    validate("registry.schema.json", registry, "registry.json")

    policy = load_json(ROOT / "policy" / "registry-policy.json")
    validate("policy.schema.json", policy, "policy/registry-policy.json")

    for package_id, relative_path in sorted(registry["packages"].items()):
        path = ROOT / relative_path
        payload = load_json(path)
        validate("package.schema.json", payload, relative_path)
        validate_package_consistency(payload, package_id, relative_path, policy)

    for publisher_id, relative_path in sorted(registry["publishers"].items()):
        path = ROOT / relative_path
        payload = load_json(path)
        validate("publisher.schema.json", payload, relative_path)
        if payload.get("id") != publisher_id:
            raise SystemExit(f"Publisher identity mismatch: registry key {publisher_id!r} != descriptor id {payload.get('id')!r}")

    trust_path = ROOT / "trust" / "trust.json"
    if trust_path.is_file():
        validate("trust.schema.json", load_json(trust_path), "trust/trust.json")

    print(
        "Registry JSON validation PASS "
        f"packages={len(registry['packages'])} publishers={len(registry['publishers'])} "
        f"trust={'active' if trust_path.is_file() else 'inactive'}"
    )


if __name__ == "__main__":
    main()
