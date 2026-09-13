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

    validate_signed_distribution_handoff(ctx, errors)


def validate_signed_distribution_handoff(ctx: ValidationContext, errors: list[str]) -> None:
    path = "docs/REGISTRY_SIGNED_DISTRIBUTION_HANDOFF_V1.yaml"
    contract = ctx.load(path)
    scan_machine(contract, path, errors)

    need(contract.get("contract_id") == "REGISTRY_SIGNED_DISTRIBUTION_HANDOFF_V1", "SIGNED_HANDOFF_CONTRACT_ID", errors)
    producer = contract.get("producer", {})
    need(producer.get("repository") == "Simple-Connection/sctool-registry", "SIGNED_HANDOFF_PRODUCER", errors)
    need(producer.get("workflow") == ".github/workflows/pages.yml", "SIGNED_HANDOFF_WORKFLOW", errors)
    consumer = contract.get("consumer", {})
    need(consumer.get("repository") == "Simple-Connection/SCTool_Marketplace_Web", "SIGNED_HANDOFF_CONSUMER", errors)
    need(consumer.get("source_mutation") == "FORBIDDEN", "SIGNED_HANDOFF_CONSUMER_MUTATION", errors)
    need(consumer.get("resigning") == "FORBIDDEN", "SIGNED_HANDOFF_CONSUMER_RESIGN", errors)

    bundle = contract.get("bundle", {})
    need(bundle.get("transport") == "GITHUB_ACTIONS_ARTIFACT_V4", "SIGNED_HANDOFF_TRANSPORT", errors)
    need(bundle.get("action") == "actions/upload-artifact@v4", "SIGNED_HANDOFF_ACTION", errors)
    need(bundle.get("name_format") == "registry-signed-distribution-{revision}", "SIGNED_HANDOFF_ARTIFACT_NAME", errors)
    need(bundle.get("file_set") == "EXACT", "SIGNED_HANDOFF_FILE_SET", errors)
    need(bundle.get("unexpected_files") == "FORBIDDEN", "SIGNED_HANDOFF_UNEXPECTED_FILES", errors)
    need(bundle.get("byte_transformation") == "FORBIDDEN", "SIGNED_HANDOFF_BYTE_TRANSFORM", errors)
    files = bundle.get("files", {})
    need(files.get("trust", {}).get("path") == "trust.json", "SIGNED_HANDOFF_TRUST_PATH", errors)
    need(files.get("head", {}).get("path") == "registry-head.json", "SIGNED_HANDOFF_HEAD_PATH", errors)
    need(files.get("snapshot", {}).get("path_format") == "snapshots/{revision}.json", "SIGNED_HANDOFF_SNAPSHOT_PATH", errors)

    identity = contract.get("identity", {})
    need(identity.get("producer_run_id", {}).get("selection") == "EXACT", "SIGNED_HANDOFF_RUN_SELECTION", errors)
    need(identity.get("artifact_id", {}).get("selection") == "EXACT", "SIGNED_HANDOFF_ARTIFACT_SELECTION", errors)
    need(identity.get("artifact_digest", {}).get("source") == "ACTIONS_UPLOAD_ARTIFACT_OUTPUT", "SIGNED_HANDOFF_DIGEST_SOURCE", errors)
    need(identity.get("mutable_latest_resolution") == "FORBIDDEN", "SIGNED_HANDOFF_MUTABLE_LATEST", errors)
    need(identity.get("name_only_resolution_without_run") == "FORBIDDEN", "SIGNED_HANDOFF_NAME_ONLY", errors)

    evidence = contract.get("evidence", {})
    schema_path = evidence.get("schema")
    need(schema_path == "schemas/registry-distribution-handoff.schema.json", "SIGNED_HANDOFF_EVIDENCE_SCHEMA", errors)
    if isinstance(schema_path, str):
        need((ctx.root / schema_path).is_file(), "SIGNED_HANDOFF_EVIDENCE_SCHEMA_MISSING", errors)
    need(evidence.get("artifact_name_format") == "registry-signed-distribution-handoff-{revision}", "SIGNED_HANDOFF_EVIDENCE_ARTIFACT", errors)

    hosting = contract.get("hosting", {})
    need(hosting.get("target_repository") == "Simple-Connection/SCTool_Marketplace_Web", "SIGNED_HANDOFF_HOST_TARGET", errors)
    need(hosting.get("signing_credentials_in_consumer") == "FORBIDDEN", "SIGNED_HANDOFF_CONSUMER_KEYS", errors)
    need(hosting.get("signed_bytes_rewrite") == "FORBIDDEN", "SIGNED_HANDOFF_REWRITE", errors)

    cutover = contract.get("cutover", {})
    need(cutover.get("registry_pages_workflow_removal") == "BLOCKED", "SIGNED_HANDOFF_EARLY_WORKFLOW_REMOVAL", errors)
    need(cutover.get("registry_pages_disable") == "BLOCKED", "SIGNED_HANDOFF_EARLY_PAGES_DISABLE", errors)

    workflow_text = (ctx.root / producer["workflow"]).read_text(encoding="utf-8")
    bundle_marker = "registry-signed-distribution-" + "$" + "{{ github.sha }}"
    evidence_marker = "registry-signed-distribution-handoff-" + "$" + "{{ github.sha }}"
    need(bundle_marker in workflow_text, "SIGNED_HANDOFF_WORKFLOW_BUNDLE", errors)
    need(evidence_marker in workflow_text, "SIGNED_HANDOFF_WORKFLOW_EVIDENCE", errors)
