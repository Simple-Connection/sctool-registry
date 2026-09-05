import {
  DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
  checkRegistryAccess,
  createGitHubCliCommandRunner,
  sanitizeRegistryGitHubEnvironment,
} from "./registry-access.mjs";

const DELIVERY_TYPE = "github-release-asset";
const ACCESS_CONTRACT = "registry-access-v1";

function freeze(value) {
  return Object.freeze(value);
}

export class RegistryArtifactDeliveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RegistryArtifactDeliveryError";
    this.code = code;
    this.details = freeze({ ...details });
  }
}

function requireString(value, code, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new RegistryArtifactDeliveryError(code, `${field} must be a non-empty string`, { field });
  }
  return value;
}

function requireAssetId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RegistryArtifactDeliveryError("invalid-asset-id", "delivery locator assetId must be a positive safe integer");
  }
  return value;
}

function validateResolvedTarget(resolvedTarget, artifactRepository) {
  if (!resolvedTarget || typeof resolvedTarget !== "object") {
    throw new RegistryArtifactDeliveryError("invalid-target", "resolved target is required");
  }
  const packageId = requireString(resolvedTarget.packageId, "invalid-package-id", "packageId");
  const version = requireString(resolvedTarget.version, "invalid-version", "version");
  const delivery = resolvedTarget.delivery;
  if (!delivery || typeof delivery !== "object") {
    throw new RegistryArtifactDeliveryError("invalid-delivery", "resolved target delivery metadata is required");
  }
  if (delivery.type !== DELIVERY_TYPE) {
    throw new RegistryArtifactDeliveryError("unsupported-delivery", "delivery type is not supported", {
      deliveryType: delivery.type ?? null,
    });
  }
  if (delivery.access?.contract !== ACCESS_CONTRACT) {
    throw new RegistryArtifactDeliveryError("unsupported-access-contract", "delivery access contract is not supported", {
      accessContract: delivery.access?.contract ?? null,
    });
  }
  const repository = delivery.locator?.repository;
  if (repository !== artifactRepository) {
    throw new RegistryArtifactDeliveryError("repository-mismatch", "delivery repository does not match Registry authority", {
      repository: repository ?? null,
      expectedRepository: artifactRepository,
    });
  }
  const assetId = requireAssetId(delivery.locator?.assetId);
  return { packageId, version, repository, assetId };
}

function commandFailure(code, message, outcome) {
  return new RegistryArtifactDeliveryError(code, message, {
    kind: outcome?.kind ?? null,
    exitCode: outcome?.kind === "completed" ? outcome.exitCode : null,
  });
}

async function requireAuthorizedAccess({ runner, environment, artifactRepository, timeoutMs }) {
  const access = await checkRegistryAccess({
    runner,
    environment,
    artifactRepository,
    timeoutMs,
  });
  if (!access.authorized) {
    throw new RegistryArtifactDeliveryError("access-not-authorized", "Registry artifact access is not authorized", {
      accessState: access.state,
      login: access.identity?.login ?? null,
    });
  }
  return access.identity;
}

export function deriveExpectedReleaseTag(packageId, version) {
  requireString(packageId, "invalid-package-id", "packageId");
  requireString(version, "invalid-version", "version");
  return `sctool/${packageId}/v${version}`;
}

export async function resolveGitHubReleaseAsset(resolvedTarget, {
  runner,
  environment = {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  if (typeof runner !== "function") {
    throw new RegistryArtifactDeliveryError("configuration-error", "GitHub CLI command runner is required");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RegistryArtifactDeliveryError("configuration-error", "timeoutMs must be positive");
  }

  const target = validateResolvedTarget(resolvedTarget, artifactRepository);
  const identity = await requireAuthorizedAccess({ runner, environment, artifactRepository, timeoutMs });
  const expectedTag = deriveExpectedReleaseTag(target.packageId, target.version);
  const env = sanitizeRegistryGitHubEnvironment(environment);
  const endpoint = `repos/${target.repository}/releases/tags/${encodeURIComponent(expectedTag)}`;
  const jq = `{id:.id,tag_name:.tag_name,draft:.draft,assets:[.assets[]|select(.id==${target.assetId})|{id,name,size}]}`;
  const outcome = await runner({
    command: "gh",
    args: ["api", endpoint, "--jq", jq],
    env,
    timeoutMs,
  });

  if (outcome?.kind !== "completed" || outcome.exitCode !== 0) {
    throw commandFailure("release-query-failed", "expected GitHub release could not be resolved", outcome);
  }

  let release;
  try {
    release = JSON.parse(String(outcome.stdout ?? ""));
  } catch {
    throw new RegistryArtifactDeliveryError("release-response-invalid", "GitHub release response is not valid JSON");
  }
  if (!release || typeof release !== "object") {
    throw new RegistryArtifactDeliveryError("release-response-invalid", "GitHub release response is invalid");
  }
  if (release.tag_name !== expectedTag) {
    throw new RegistryArtifactDeliveryError("release-tag-mismatch", "resolved GitHub release tag does not match expected tag", {
      expectedTag,
      actualTag: release.tag_name ?? null,
    });
  }
  if (release.draft !== false) {
    throw new RegistryArtifactDeliveryError("release-draft", "draft GitHub releases cannot resolve Registry artifacts");
  }
  if (!Array.isArray(release.assets)) {
    throw new RegistryArtifactDeliveryError("release-response-invalid", "GitHub release assets are missing");
  }
  const matches = release.assets.filter((asset) => asset?.id === target.assetId);
  if (matches.length === 0) {
    throw new RegistryArtifactDeliveryError("asset-not-found", "delivery assetId is absent from the expected release", {
      assetId: target.assetId,
      expectedTag,
    });
  }
  if (matches.length !== 1) {
    throw new RegistryArtifactDeliveryError("asset-not-unique", "delivery assetId resolved more than once in the expected release", {
      assetId: target.assetId,
      expectedTag,
      matches: matches.length,
    });
  }

  const asset = matches[0];
  return freeze({
    packageId: target.packageId,
    version: target.version,
    targetKey: resolvedTarget.targetKey ?? null,
    repository: target.repository,
    expectedTag,
    releaseId: Number.isSafeInteger(release.id) ? release.id : null,
    assetId: target.assetId,
    backendAssetName: typeof asset.name === "string" ? asset.name : null,
    backendAssetSize: Number.isSafeInteger(asset.size) ? asset.size : null,
    assetApiPath: `repos/${target.repository}/releases/assets/${target.assetId}`,
    identity,
  });
}

export function createGitHubCliBinaryCommandRunner({ execFileImpl, maxBufferBytes } = {}) {
  if (typeof execFileImpl !== "function") return null;
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes <= 0) return null;

  return ({ command, args, env, timeoutMs }) =>
    new Promise((resolve) => {
      execFileImpl(
        command,
        [...args],
        {
          env,
          encoding: null,
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: maxBufferBytes,
        },
        (error, stdout = new Uint8Array(), stderr = new Uint8Array()) => {
          const bytes = stdout instanceof Uint8Array ? new Uint8Array(stdout) : new TextEncoder().encode(String(stdout ?? ""));
          const diagnostic = stderr instanceof Uint8Array ? new TextDecoder().decode(stderr) : String(stderr ?? "");
          if (!error) {
            resolve({ kind: "completed", exitCode: 0, stdout: bytes, stderr: diagnostic });
            return;
          }
          if (error.code === "ENOENT") {
            resolve({ kind: "not-found" });
            return;
          }
          if (error.killed || error.code === "ETIMEDOUT") {
            resolve({ kind: "timeout" });
            return;
          }
          if (typeof error.code === "number") {
            resolve({ kind: "completed", exitCode: error.code, stdout: bytes, stderr: diagnostic });
            return;
          }
          resolve({ kind: "transport-error" });
        },
      );
    });
}

export async function retrieveGitHubReleaseAsset(resolvedTarget, {
  runner,
  binaryRunner,
  environment = {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  if (typeof runner !== "function" || typeof binaryRunner !== "function") {
    throw new RegistryArtifactDeliveryError("configuration-error", "text and binary GitHub CLI runners are required");
  }

  const resolvedAsset = await resolveGitHubReleaseAsset(resolvedTarget, {
    runner,
    environment,
    artifactRepository,
    timeoutMs,
  });
  const env = sanitizeRegistryGitHubEnvironment(environment);
  const outcome = await binaryRunner({
    command: "gh",
    args: ["api", resolvedAsset.assetApiPath, "-H", "Accept: application/octet-stream"],
    env,
    timeoutMs,
  });
  if (outcome?.kind !== "completed" || outcome.exitCode !== 0) {
    throw commandFailure("download-failed", "exact GitHub release asset retrieval failed", outcome);
  }
  if (!(outcome.stdout instanceof Uint8Array)) {
    throw new RegistryArtifactDeliveryError("download-response-invalid", "artifact retrieval did not return binary bytes");
  }

  return {
    packageId: resolvedAsset.packageId,
    version: resolvedAsset.version,
    targetKey: resolvedAsset.targetKey,
    repository: resolvedAsset.repository,
    expectedTag: resolvedAsset.expectedTag,
    assetId: resolvedAsset.assetId,
    identity: resolvedAsset.identity,
    bytes: new Uint8Array(outcome.stdout),
  };
}

export async function resolveGitHubReleaseAssetWithGitHubCli(resolvedTarget, {
  execFileImpl,
  environment = globalThis.process?.env ?? {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const runner = createGitHubCliCommandRunner({ execFileImpl });
  if (!runner) {
    throw new RegistryArtifactDeliveryError("configuration-error", "execFileImpl is required");
  }
  return resolveGitHubReleaseAsset(resolvedTarget, {
    runner,
    environment,
    artifactRepository,
    timeoutMs,
  });
}

export async function retrieveGitHubReleaseAssetWithGitHubCli(resolvedTarget, {
  execFileImpl,
  maxBufferBytes,
  environment = globalThis.process?.env ?? {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const runner = createGitHubCliCommandRunner({ execFileImpl });
  const binaryRunner = createGitHubCliBinaryCommandRunner({ execFileImpl, maxBufferBytes });
  if (!runner || !binaryRunner) {
    throw new RegistryArtifactDeliveryError("configuration-error", "execFileImpl and positive maxBufferBytes are required");
  }
  return retrieveGitHubReleaseAsset(resolvedTarget, {
    runner,
    binaryRunner,
    environment,
    artifactRepository,
    timeoutMs,
  });
}
