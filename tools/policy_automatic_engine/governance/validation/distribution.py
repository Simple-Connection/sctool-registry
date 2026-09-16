from __future__ import annotations

import json

from .common import need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    validate_registry_client_sdk_distribution(ctx, errors)
    validate_authoring_sdk_distribution(ctx, errors)
    validate_signed_distribution_handoff(ctx, errors)


def _validate_public_package_json(
    ctx: ValidationContext,
    package_root: str,
    expected_name: str,
    expected_version: str,
    errors: list[str],
    prefix: str,
) -> None:
    package_path = ctx.root / package_root / "package.json"
    need(package_path.is_file(), f"{prefix}_PACKAGE_JSON_MISSING", errors)
    if not package_path.is_file():
        return
    package_json = json.loads(package_path.read_text(encoding="utf-8"))
    need(package_json.get("name") == expected_name, f"{prefix}_PACKAGE_NAME", errors)
    need(package_json.get("version") == expected_version, f"{prefix}_PACKAGE_VERSION", errors)
    need(package_json.get("private") is not True, f"{prefix}_PACKAGE_PRIVATE_FLAG", errors)
    publish_config = package_json.get("publishConfig", {})
    need(
        publish_config.get("registry") == "https://registry.npmjs.org",
        f"{prefix}_PACKAGE_PUBLISH_REGISTRY",
        errors,
    )
    need(publish_config.get("access") == "public", f"{prefix}_PACKAGE_PUBLISH_ACCESS", errors)


def _validate_public_npm_workflow(
    workflow_text: str,
    errors: list[str],
    prefix: str,
) -> None:
    need("id-token: write" in workflow_text, f"{prefix}_WORKFLOW_OIDC_PERMISSION", errors)
    need("packages: write" not in workflow_text, f"{prefix}_WORKFLOW_GITHUB_PACKAGES_RETIRED", errors)
    need("https://registry.npmjs.org" in workflow_text, f"{prefix}_WORKFLOW_NPMJS_REGISTRY", errors)
    need("--access public" in workflow_text, f"{prefix}_WORKFLOW_PUBLIC_ACCESS", errors)
    need("secrets.NPM_TOKEN" in workflow_text, f"{prefix}_WORKFLOW_BOOTSTRAP_TOKEN", errors)
    need("NPM_CONFIG_USERCONFIG: /dev/null" in workflow_text, f"{prefix}_WORKFLOW_ANONYMOUS_VERIFY", errors)
    need('node-version: "24"' in workflow_text, f"{prefix}_WORKFLOW_NODE_24", errors)


def validate_registry_client_sdk_distribution(ctx: ValidationContext, errors: list[str]) -> None:
    contract = ctx.registry_client_sdk_distribution
    path = "docs/REGISTRY_CLIENT_SDK_DISTRIBUTION_V1.yaml"
    scan_machine(contract, path, errors)

    need(contract.get("contract_id") == "REGISTRY_CLIENT_SDK_DISTRIBUTION_V1", "SDK_DISTRIBUTION_CONTRACT_ID", errors)
    need(contract.get("responsibility") == "RESP_REGISTRY_CLIENT_SDK_PACKAGE_PUBLICATION", "SDK_DISTRIBUTION_RESPONSIBILITY", errors)
    need(contract.get("authority") == "AUTH_REGISTRY_SDK_PACKAGE_DELIVERY", "SDK_DISTRIBUTION_AUTHORITY", errors)
    need(contract.get("mechanism") == "NPMJS_PUBLIC_REGISTRY", "SDK_DISTRIBUTION_MECHANISM", errors)
    need(contract.get("registry") == "https://registry.npmjs.org", "SDK_DISTRIBUTION_REGISTRY", errors)
    need(contract.get("package") == "@simple-connection/sctool-registry-client-sdk", "SDK_DISTRIBUTION_PACKAGE", errors)
    need(contract.get("version") == "0.2.2", "SDK_DISTRIBUTION_VERSION", errors)
    need(contract.get("visibility") == "PUBLIC", "SDK_DISTRIBUTION_VISIBILITY", errors)

    consumer = contract.get("consumer", {})
    need(consumer.get("primary_repository") == "Simple-Connection/SC_Linked_App", "SDK_DISTRIBUTION_PRIMARY_CONSUMER", errors)
    need(consumer.get("public_consumers") == "ALLOWED", "SDK_DISTRIBUTION_PUBLIC_CONSUMERS", errors)
    need(consumer.get("authentication") == "NOT_REQUIRED", "SDK_DISTRIBUTION_CONSUMER_AUTH", errors)
    need(consumer.get("anonymous_installation") == "REQUIRED", "SDK_DISTRIBUTION_ANONYMOUS_INSTALL", errors)
    need(consumer.get("exact_version_pin") == "REQUIRED", "SDK_DISTRIBUTION_EXACT_PIN", errors)

    policy = contract.get("version_policy", {})
    need(policy.get("dependency_range") == "EXACT", "SDK_DISTRIBUTION_EXACT_VERSION", errors)
    need(policy.get("caret") == "FORBIDDEN", "SDK_DISTRIBUTION_CARET", errors)
    need(policy.get("tilde") == "FORBIDDEN", "SDK_DISTRIBUTION_TILDE", errors)
    need(policy.get("lockfile") == "REQUIRED", "SDK_DISTRIBUTION_LOCKFILE", errors)

    publish = contract.get("publish", {})
    workflow = publish.get("workflow")
    need(workflow == ".github/workflows/publish-registry-client-sdk.yml", "SDK_DISTRIBUTION_WORKFLOW", errors)
    need(isinstance(workflow, str) and (ctx.root / workflow).is_file(), "SDK_DISTRIBUTION_WORKFLOW_MISSING", errors)
    need(publish.get("from_ci") == "REQUIRED", "SDK_DISTRIBUTION_CI", errors)
    need(publish.get("access") == "PUBLIC", "SDK_DISTRIBUTION_PUBLIC_ACCESS", errors)
    need(publish.get("pack_before_publish") == "REQUIRED", "SDK_DISTRIBUTION_PACK", errors)
    need(publish.get("local_integrity_evidence") == "REQUIRED", "SDK_DISTRIBUTION_LOCAL_INTEGRITY", errors)
    need(publish.get("remote_integrity_verification") == "REQUIRED", "SDK_DISTRIBUTION_REMOTE_INTEGRITY", errors)
    need(publish.get("anonymous_remote_verification") == "REQUIRED", "SDK_DISTRIBUTION_ANONYMOUS_REMOTE", errors)
    existing = publish.get("existing_version", {})
    need(existing.get("integrity_equal") == "REUSE", "SDK_DISTRIBUTION_REUSE", errors)
    need(existing.get("integrity_mismatch") == "FAIL_CLOSED", "SDK_DISTRIBUTION_MISMATCH", errors)

    auth = contract.get("authentication", {})
    publication = auth.get("publication", {})
    need(publication.get("preferred") == "NPM_TRUSTED_PUBLISHING_OIDC", "SDK_DISTRIBUTION_CI_AUTH", errors)
    need(publication.get("bootstrap") == "NPM_TOKEN", "SDK_DISTRIBUTION_BOOTSTRAP_AUTH", errors)
    need(publication.get("source_controlled_token") == "FORBIDDEN", "SDK_DISTRIBUTION_LOCAL_TOKEN", errors)
    github_actions = publication.get("github_actions", {})
    need(github_actions.get("id_token_permission") == "WRITE", "SDK_DISTRIBUTION_OIDC_PERMISSION", errors)
    need(github_actions.get("runner") == "GITHUB_HOSTED", "SDK_DISTRIBUTION_OIDC_RUNNER", errors)
    need(github_actions.get("node_major") == 24, "SDK_DISTRIBUTION_NODE_MAJOR", errors)
    need(github_actions.get("npm_minimum") == "11.5.1", "SDK_DISTRIBUTION_NPM_MINIMUM", errors)
    consumer_auth = auth.get("consumer", {})
    need(consumer_auth.get("required") is False, "SDK_DISTRIBUTION_CONSUMER_AUTH_REQUIRED", errors)
    need(consumer_auth.get("token") == "FORBIDDEN_AS_REQUIREMENT", "SDK_DISTRIBUTION_CONSUMER_TOKEN", errors)

    trusted = contract.get("trusted_publisher", {})
    need(trusted.get("provider") == "GITHUB_ACTIONS", "SDK_DISTRIBUTION_TRUST_PROVIDER", errors)
    need(trusted.get("repository") == "Simple-Connection/sctool-registry", "SDK_DISTRIBUTION_TRUST_REPOSITORY", errors)
    need(trusted.get("workflow_filename") == "publish-registry-client-sdk.yml", "SDK_DISTRIBUTION_TRUST_WORKFLOW", errors)
    need(trusted.get("allowed_action") == "NPM_PUBLISH", "SDK_DISTRIBUTION_TRUST_ACTION", errors)

    producer = contract.get("producer", {})
    package_root = producer.get("package_root")
    need(package_root == "packages/registry-client-sdk", "SDK_DISTRIBUTION_PACKAGE_ROOT", errors)
    if isinstance(package_root, str):
        _validate_public_package_json(
            ctx,
            package_root,
            "@simple-connection/sctool-registry-client-sdk",
            "0.2.2",
            errors,
            "SDK",
        )

    if isinstance(workflow, str) and (ctx.root / workflow).is_file():
        workflow_text = (ctx.root / workflow).read_text(encoding="utf-8")
        _validate_public_npm_workflow(workflow_text, errors, "SDK")
        need("npm pack --json" in workflow_text, "SDK_WORKFLOW_PACK", errors)
        need("dist.integrity" in workflow_text, "SDK_WORKFLOW_REMOTE_INTEGRITY", errors)
        need("@simple-connection/sctool-registry-client-sdk@0.2.2" in workflow_text, "SDK_WORKFLOW_VERSION", errors)


def validate_authoring_sdk_distribution(ctx: ValidationContext, errors: list[str]) -> None:
    path = "docs/AUTHORING_SDK_DISTRIBUTION_V1.yaml"
    contract = ctx.load(path)
    scan_machine(contract, path, errors)

    need(contract.get("schema_version") == "1.3", "AUTHORING_DISTRIBUTION_SCHEMA_VERSION", errors)
    need(contract.get("contract_id") == "AUTHORING_SDK_DISTRIBUTION_V1", "AUTHORING_DISTRIBUTION_CONTRACT_ID", errors)
    need(contract.get("mechanism") == "NPMJS_PUBLIC_REGISTRY", "AUTHORING_DISTRIBUTION_MECHANISM", errors)
    need(contract.get("registry") == "https://registry.npmjs.org", "AUTHORING_DISTRIBUTION_REGISTRY", errors)
    need(contract.get("source_repository") == "Simple-Connection/sctool-registry", "AUTHORING_DISTRIBUTION_SOURCE", errors)
    workflow = contract.get("workflow")
    need(workflow == ".github/workflows/publish-authoring-sdks.yml", "AUTHORING_DISTRIBUTION_WORKFLOW", errors)
    need(isinstance(workflow, str) and (ctx.root / workflow).is_file(), "AUTHORING_DISTRIBUTION_WORKFLOW_MISSING", errors)

    packages = contract.get("packages", {})
    expected = {
        "SCTOOL_AUTHORING_SDK": (
            "packages/sctool-sdk",
            "@simple-connection/sctool-sdk",
            "0.2.1",
            "AUTH_SCTOOL_AUTHORING_SDK",
        ),
        "REPOSITORY_TOOL_AUTHORING_SDK": (
            "packages/repository-tool-sdk",
            "@simple-connection/repository-tool-sdk",
            "0.1.1",
            "AUTH_REPOSITORY_TOOL_AUTHORING_SDK",
        ),
    }
    for key, (package_root, package_name, version, authority) in expected.items():
        item = packages.get(key, {})
        prefix = f"AUTHORING_{key}"
        need(item.get("source") == package_root, f"{prefix}_SOURCE", errors)
        need(item.get("package") == package_name, f"{prefix}_NAME", errors)
        need(item.get("version") == version, f"{prefix}_VERSION", errors)
        need(item.get("authority") == authority, f"{prefix}_AUTHORITY", errors)
        need(item.get("visibility") == "PUBLIC", f"{prefix}_VISIBILITY", errors)
        _validate_public_package_json(ctx, package_root, package_name, version, errors, prefix)

    publication = contract.get("publication", {})
    need(publication.get("authority") == "AUTH_AUTHORING_SDK_PACKAGE_DELIVERY", "AUTHORING_DISTRIBUTION_AUTHORITY", errors)
    need(publication.get("access") == "PUBLIC", "AUTHORING_DISTRIBUTION_PUBLIC_ACCESS", errors)
    need(publication.get("immutable_version") is True, "AUTHORING_DISTRIBUTION_IMMUTABLE", errors)
    need(publication.get("exact_source_revision_evidence") is True, "AUTHORING_DISTRIBUTION_REVISION_EVIDENCE", errors)
    need(publication.get("tarball_integrity_evidence") == "REQUIRED", "AUTHORING_DISTRIBUTION_TARBALL_EVIDENCE", errors)
    need(publication.get("tarball_integrity_match_required") is False, "AUTHORING_DISTRIBUTION_TARBALL_MATCH_NOT_AUTHORITY", errors)
    need(publication.get("anonymous_remote_verification") is True, "AUTHORING_DISTRIBUTION_ANONYMOUS_REMOTE", errors)
    content_verification = publication.get("content_verification", {})
    need(content_verification.get("method") == "EXACT_PACKAGE_CONTENT_SHA256_V1", "AUTHORING_DISTRIBUTION_CONTENT_METHOD", errors)
    need(content_verification.get("manifest_format") == "npm-package-content-manifest/v1", "AUTHORING_DISTRIBUTION_CONTENT_MANIFEST", errors)
    need(content_verification.get("path_set") == "EXACT", "AUTHORING_DISTRIBUTION_CONTENT_PATH_SET", errors)
    need(content_verification.get("file_bytes_sha256") == "REQUIRED", "AUTHORING_DISTRIBUTION_CONTENT_FILE_SHA256", errors)
    need(content_verification.get("file_mode") == "REQUIRED", "AUTHORING_DISTRIBUTION_CONTENT_FILE_MODE", errors)
    need(content_verification.get("symlink_target") == "REQUIRED", "AUTHORING_DISTRIBUTION_CONTENT_SYMLINK", errors)
    need(content_verification.get("remote_retrieval") == "ANONYMOUS", "AUTHORING_DISTRIBUTION_CONTENT_ANONYMOUS", errors)
    need(content_verification.get("mismatch") == "FAIL_CLOSED", "AUTHORING_DISTRIBUTION_CONTENT_FAIL_CLOSED", errors)
    existing_resolution = content_verification.get("existing_version_resolution", {})
    need(existing_resolution.get("primary") == "ANONYMOUS_CONTENT_FETCH", "AUTHORING_DISTRIBUTION_EXISTING_PRIMARY", errors)
    need(existing_resolution.get("metadata_authority") == "FORBIDDEN", "AUTHORING_DISTRIBUTION_METADATA_AUTHORITY", errors)
    need(existing_resolution.get("publish_conflict_recovery") == "EXACT_CONTENT_VERIFY", "AUTHORING_DISTRIBUTION_CONFLICT_RECOVERY", errors)
    need(existing_resolution.get("publish_conflict_result") == "EXISTING_VERIFIED", "AUTHORING_DISTRIBUTION_CONFLICT_RESULT", errors)
    publication_auth = publication.get("authentication", {})
    need(publication_auth.get("preferred") == "NPM_TRUSTED_PUBLISHING_OIDC", "AUTHORING_DISTRIBUTION_CI_AUTH", errors)
    need(publication_auth.get("bootstrap") == "NPM_TOKEN", "AUTHORING_DISTRIBUTION_BOOTSTRAP_AUTH", errors)
    need(publication_auth.get("source_controlled_token") == "FORBIDDEN", "AUTHORING_DISTRIBUTION_SOURCE_TOKEN", errors)
    github_actions = publication_auth.get("github_actions", {})
    need(github_actions.get("id_token_permission") == "WRITE", "AUTHORING_DISTRIBUTION_OIDC_PERMISSION", errors)
    need(github_actions.get("runner") == "GITHUB_HOSTED", "AUTHORING_DISTRIBUTION_OIDC_RUNNER", errors)
    need(github_actions.get("node_major") == 24, "AUTHORING_DISTRIBUTION_NODE_MAJOR", errors)
    need(github_actions.get("npm_minimum") == "11.5.1", "AUTHORING_DISTRIBUTION_NPM_MINIMUM", errors)

    consumer = contract.get("consumer", {})
    need(consumer.get("primary_repository") == "Simple-Connection/SC_Linked_App", "AUTHORING_DISTRIBUTION_PRIMARY_CONSUMER", errors)
    need(consumer.get("public_consumers") == "ALLOWED", "AUTHORING_DISTRIBUTION_PUBLIC_CONSUMERS", errors)
    need(consumer.get("authentication") == "NOT_REQUIRED", "AUTHORING_DISTRIBUTION_CONSUMER_AUTH", errors)
    need(consumer.get("anonymous_installation") == "REQUIRED", "AUTHORING_DISTRIBUTION_ANONYMOUS_INSTALL", errors)
    need(consumer.get("exact_version_pin_required") is True, "AUTHORING_DISTRIBUTION_EXACT_PIN", errors)

    trusted = contract.get("trusted_publisher", {})
    need(trusted.get("provider") == "GITHUB_ACTIONS", "AUTHORING_DISTRIBUTION_TRUST_PROVIDER", errors)
    need(trusted.get("repository") == "Simple-Connection/sctool-registry", "AUTHORING_DISTRIBUTION_TRUST_REPOSITORY", errors)
    need(trusted.get("workflow_filename") == "publish-authoring-sdks.yml", "AUTHORING_DISTRIBUTION_TRUST_WORKFLOW", errors)
    need(trusted.get("allowed_action") == "NPM_PUBLISH", "AUTHORING_DISTRIBUTION_TRUST_ACTION", errors)

    if isinstance(workflow, str) and (ctx.root / workflow).is_file():
        workflow_text = (ctx.root / workflow).read_text(encoding="utf-8")
        _validate_public_npm_workflow(workflow_text, errors, "AUTHORING")
        need("@simple-connection/sctool-sdk@0.2.1" in workflow_text, "AUTHORING_WORKFLOW_SCTOOL_VERSION", errors)
        need("@simple-connection/repository-tool-sdk@0.1.1" in workflow_text, "AUTHORING_WORKFLOW_REPOSITORY_TOOL_VERSION", errors)
        need("EXACT_PACKAGE_CONTENT_SHA256_V1" in workflow_text, "AUTHORING_WORKFLOW_CONTENT_METHOD", errors)
        need("npm-package-content-manifest/v1" in workflow_text, "AUTHORING_WORKFLOW_CONTENT_MANIFEST", errors)
        need("remote_content_digest" in workflow_text, "AUTHORING_WORKFLOW_CONTENT_REMOTE_DIGEST", errors)
        need("local_content_digest" in workflow_text, "AUTHORING_WORKFLOW_CONTENT_LOCAL_DIGEST", errors)
        need("env -u NODE_AUTH_TOKEN NPM_CONFIG_USERCONFIG=/dev/null" in workflow_text, "AUTHORING_WORKFLOW_ANONYMOUS_CONTENT_FETCH", errors)
        need("*-content-manifest.json" in workflow_text, "AUTHORING_WORKFLOW_CONTENT_EVIDENCE", errors)
        need("ANONYMOUS_CONTENT_FETCH" in workflow_text, "AUTHORING_WORKFLOW_EXISTING_PRIMARY", errors)
        need("PUBLISH_CONFLICT_RECOVERED" in workflow_text, "AUTHORING_WORKFLOW_CONFLICT_RECOVERY", errors)
        need("cannot publish over (the )?previously published versions" in workflow_text, "AUTHORING_WORKFLOW_CONFLICT_PATTERN", errors)
        need("metadata freshness is not authoritative" in workflow_text, "AUTHORING_WORKFLOW_METADATA_NOT_AUTHORITY", errors)
        need("Remote integrity mismatch after publication" not in workflow_text, "AUTHORING_WORKFLOW_RAW_TARBALL_MATCH_RETIRED", errors)


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
    need(identity.get("artifact_digest", {}).get("source") == "ACTIONS_UPLOAD_ARTIFACT_OUTPUT_NORMALIZED_SHA256", "SIGNED_HANDOFF_DIGEST_SOURCE", errors)
    need(identity.get("mutable_latest_resolution") == "FORBIDDEN", "SIGNED_HANDOFF_MUTABLE_LATEST", errors)
    need(identity.get("name_only_resolution_without_run") == "FORBIDDEN", "SIGNED_HANDOFF_NAME_ONLY", errors)

    evidence = contract.get("evidence", {})
    schema_path = evidence.get("schema")
    need(
        schema_path == "tools/policy_automatic_engine/schemas/registry/registry-distribution-handoff.schema.json",
        "SIGNED_HANDOFF_EVIDENCE_SCHEMA",
        errors,
    )
    if isinstance(schema_path, str):
        need((ctx.root / schema_path).is_file(), "SIGNED_HANDOFF_EVIDENCE_SCHEMA_MISSING", errors)
    need(evidence.get("artifact_name_format") == "registry-signed-distribution-handoff-{revision}", "SIGNED_HANDOFF_EVIDENCE_ARTIFACT", errors)

    hosting = contract.get("hosting", {})
    need(hosting.get("target_repository") == "Simple-Connection/SCTool_Marketplace_Web", "SIGNED_HANDOFF_HOST_TARGET", errors)
    need(hosting.get("signing_credentials_in_consumer") == "FORBIDDEN", "SIGNED_HANDOFF_CONSUMER_KEYS", errors)
    need(hosting.get("signed_bytes_rewrite") == "FORBIDDEN", "SIGNED_HANDOFF_REWRITE", errors)

    cutover = contract.get("cutover", {})
    need(cutover.get("legacy_registry_pages_publication") == "RETIRED", "SIGNED_HANDOFF_LEGACY_PAGES_STATE", errors)
    need(cutover.get("registry_producer_workflow") == "PRESERVED", "SIGNED_HANDOFF_PRODUCER_WORKFLOW_STATE", errors)
    need(cutover.get("registry_pages_workflow_removal") == "FORBIDDEN", "SIGNED_HANDOFF_WORKFLOW_REMOVAL", errors)
    need(cutover.get("registry_pages_disable") == "FORBIDDEN", "SIGNED_HANDOFF_WORKFLOW_DISABLE", errors)
    need(cutover.get("marketplace_hosting") == "ACTIVE", "SIGNED_HANDOFF_MARKETPLACE_HOSTING", errors)
    need(
        cutover.get("marketplace_public_base_url")
        == "https://simple-connection.github.io/SCTool_Marketplace_Web/registry/",
        "SIGNED_HANDOFF_MARKETPLACE_URL",
        errors,
    )

    workflow_text = (ctx.root / producer["workflow"]).read_text(encoding="utf-8")
    bundle_marker = "registry-signed-distribution-" + "$" + "{{ github.sha }}"
    evidence_marker = "registry-signed-distribution-handoff-" + "$" + "{{ github.sha }}"
    need(bundle_marker in workflow_text, "SIGNED_HANDOFF_WORKFLOW_BUNDLE", errors)
    need(evidence_marker in workflow_text, "SIGNED_HANDOFF_WORKFLOW_EVIDENCE", errors)
