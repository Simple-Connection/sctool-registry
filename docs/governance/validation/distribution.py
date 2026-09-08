from __future__ import annotations

import json

from .common import need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    contract = ctx.registry_client_sdk_distribution
    scan_machine(contract, "docs/REGISTRY_CLIENT_SDK_DISTRIBUTION_V1.yaml", errors)

    need(
        contract.get("contract_id") == "REGISTRY_CLIENT_SDK_DISTRIBUTION_V1",
        "SDK_DISTRIBUTION_CONTRACT_ID",
        errors,
    )
    need(
        contract.get("responsibility") == "RESP_REGISTRY_CLIENT_SDK_PACKAGE_PUBLICATION",
        "SDK_DISTRIBUTION_RESPONSIBILITY",
        errors,
    )
    need(
        contract.get("authority") == "AUTH_REGISTRY_SDK_PACKAGE_DELIVERY",
        "SDK_DISTRIBUTION_AUTHORITY",
        errors,
    )
    need(contract.get("mechanism") == "GITHUB_PACKAGES", "SDK_DISTRIBUTION_MECHANISM", errors)
    need(contract.get("registry") == "https://npm.pkg.github.com", "SDK_DISTRIBUTION_REGISTRY", errors)
    need(
        contract.get("package") == "@simple-connection/sctool-registry-client-sdk",
        "SDK_DISTRIBUTION_PACKAGE",
        errors,
    )
    need(contract.get("visibility") == "PRIVATE", "SDK_DISTRIBUTION_VISIBILITY", errors)

    policy = contract.get("version_policy", {})
    need(policy.get("dependency_range") == "EXACT", "SDK_DISTRIBUTION_EXACT_VERSION", errors)
    need(policy.get("caret") == "FORBIDDEN", "SDK_DISTRIBUTION_CARET", errors)
    need(policy.get("tilde") == "FORBIDDEN", "SDK_DISTRIBUTION_TILDE", errors)
    need(policy.get("lockfile") == "REQUIRED", "SDK_DISTRIBUTION_LOCKFILE", errors)

    publish = contract.get("publish", {})
    workflow = publish.get("workflow")
    need(
        workflow == ".github/workflows/publish-registry-client-sdk.yml",
        "SDK_DISTRIBUTION_WORKFLOW",
        errors,
    )
    need((ctx.root / workflow).is_file(), "SDK_DISTRIBUTION_WORKFLOW_MISSING", errors)
    need(publish.get("from_ci") == "REQUIRED", "SDK_DISTRIBUTION_CI", errors)
    need(publish.get("pack_before_publish") == "REQUIRED", "SDK_DISTRIBUTION_PACK", errors)
    need(publish.get("local_integrity_evidence") == "REQUIRED", "SDK_DISTRIBUTION_LOCAL_INTEGRITY", errors)
    need(publish.get("remote_integrity_verification") == "REQUIRED", "SDK_DISTRIBUTION_REMOTE_INTEGRITY", errors)
    existing = publish.get("existing_version", {})
    need(existing.get("integrity_equal") == "REUSE", "SDK_DISTRIBUTION_REUSE", errors)
    need(existing.get("integrity_mismatch") == "FAIL_CLOSED", "SDK_DISTRIBUTION_MISMATCH", errors)

    auth = contract.get("authentication", {})
    need(auth.get("ci", {}).get("preferred") == "GITHUB_TOKEN", "SDK_DISTRIBUTION_CI_AUTH", errors)
    need(
        auth.get("local_development", {}).get("source_controlled_token") == "FORBIDDEN",
        "SDK_DISTRIBUTION_LOCAL_TOKEN",
        errors,
    )

    package_path = ctx.root / contract["producer"]["package_root"] / "package.json"
    package_json = json.loads(package_path.read_text(encoding="utf-8"))
    need(package_json.get("name") == contract.get("package"), "SDK_PACKAGE_NAME", errors)
    need(package_json.get("private") is not True, "SDK_PACKAGE_PRIVATE_FLAG", errors)
    publish_config = package_json.get("publishConfig", {})
    need(publish_config.get("registry") == contract.get("registry"), "SDK_PACKAGE_PUBLISH_REGISTRY", errors)
    need(publish_config.get("access") == "restricted", "SDK_PACKAGE_PUBLISH_ACCESS", errors)

    workflow_text = (ctx.root / workflow).read_text(encoding="utf-8")
    need("packages: write" in workflow_text, "SDK_WORKFLOW_PACKAGES_WRITE", errors)
    need("npm pack --json" in workflow_text, "SDK_WORKFLOW_PACK", errors)
    need("dist.integrity" in workflow_text, "SDK_WORKFLOW_REMOTE_INTEGRITY", errors)
