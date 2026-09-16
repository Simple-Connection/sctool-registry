import {
  DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
  createGitHubCliCommandRunner,
} from "./registry-access.mjs";
import {
  createGitHubCliStreamCommandRunner,
  openGitHubReleaseAssetStream,
} from "./artifact-delivery.mjs";
import { stageAndVerifyRetrievedArtifact } from "./artifact-integrity.mjs";
import { createVerifiedArtifactLease } from "./verified-artifact.mjs";

export class RegistryInitialInstallCandidateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RegistryInitialInstallCandidateError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function freezeCopy(value) {
  return Object.freeze({ ...value });
}

function requireResolvedTarget(resolvedTarget) {
  if (!resolvedTarget || typeof resolvedTarget !== "object") {
    throw new RegistryInitialInstallCandidateError("invalid-target", "resolved target is required");
  }
  for (const field of ["packageId", "version", "targetKey", "publishedAt"]) {
    if (typeof resolvedTarget[field] !== "string" || resolvedTarget[field].length === 0) {
      throw new RegistryInitialInstallCandidateError("invalid-target", `${field} must be a non-empty string`, { field });
    }
  }
  if (!resolvedTarget.target || typeof resolvedTarget.target.platform !== "string" || typeof resolvedTarget.target.arch !== "string") {
    throw new RegistryInitialInstallCandidateError("invalid-target", "target platform and arch are required");
  }
  if (!resolvedTarget.content || typeof resolvedTarget.content !== "object") {
    throw new RegistryInitialInstallCandidateError("invalid-target", "content metadata is required");
  }
  if (!resolvedTarget.delivery || typeof resolvedTarget.delivery !== "object") {
    throw new RegistryInitialInstallCandidateError("invalid-target", "delivery metadata is required");
  }
  if (!resolvedTarget.contract || typeof resolvedTarget.contract.sctoolSpecVersion !== "string") {
    throw new RegistryInitialInstallCandidateError("invalid-target", "SCTool contract metadata is required");
  }
}

function buildCandidate(resolvedTarget, verifiedRecord, lease) {
  return Object.freeze({
    packageId: resolvedTarget.packageId,
    channel: resolvedTarget.channel ?? null,
    version: resolvedTarget.version,
    targetKey: resolvedTarget.targetKey,
    target: freezeCopy({
      platform: resolvedTarget.target.platform,
      arch: resolvedTarget.target.arch,
    }),
    content: freezeCopy({
      filename: resolvedTarget.content.filename,
      sha256: resolvedTarget.content.sha256,
      size: resolvedTarget.content.size,
    }),
    delivery: freezeCopy({
      type: resolvedTarget.delivery.type,
      repository: verifiedRecord.repository,
      assetId: verifiedRecord.assetId,
      expectedTag: verifiedRecord.expectedTag,
    }),
    publishedAt: resolvedTarget.publishedAt,
    contract: freezeCopy({
      sctoolSpecVersion: resolvedTarget.contract.sctoolSpecVersion,
    }),
    artifact: lease,
  });
}

export async function resolveInitialInstallCandidate(resolvedTarget, {
  runner,
  streamRunner,
  environment = {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  requireResolvedTarget(resolvedTarget);
  if (typeof runner !== "function" || typeof streamRunner !== "function") {
    throw new RegistryInitialInstallCandidateError(
      "configuration-error",
      "runner and streamRunner are required for initial-install candidate retrieval",
    );
  }

  const retrieval = await openGitHubReleaseAssetStream(resolvedTarget, {
    runner,
    streamRunner,
    environment,
    artifactRepository,
    timeoutMs,
  });
  const verifiedRecord = await stageAndVerifyRetrievedArtifact(resolvedTarget, retrieval);
  const lease = createVerifiedArtifactLease(verifiedRecord);
  try {
    const candidate = buildCandidate(resolvedTarget, verifiedRecord, lease);
    return Object.freeze({
      packageId: resolvedTarget.packageId,
      targetKey: resolvedTarget.targetKey,
      resolvedVersion: resolvedTarget.version,
      state: "INITIAL_INSTALL_READY",
      candidate,
    });
  } catch (error) {
    try { await lease.dispose(); } catch {}
    throw error;
  }
}

export async function resolveInitialInstallCandidateWithGitHubCli(resolvedTarget, {
  execFileImpl,
  spawnImpl,
  environment = globalThis.process?.env ?? {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  requireResolvedTarget(resolvedTarget);
  const runner = createGitHubCliCommandRunner({ execFileImpl });
  const streamRunner = createGitHubCliStreamCommandRunner({ spawnImpl });
  if (!runner || !streamRunner) {
    throw new RegistryInitialInstallCandidateError(
      "configuration-error",
      "execFileImpl and spawnImpl are required for initial-install candidate retrieval",
    );
  }
  return resolveInitialInstallCandidate(resolvedTarget, {
    runner,
    streamRunner,
    environment,
    artifactRepository,
    timeoutMs,
  });
}
