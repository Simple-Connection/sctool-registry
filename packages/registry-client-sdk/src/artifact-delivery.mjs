import {
  DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
  checkRegistryAccess,
  createGitHubCliCommandRunner,
  sanitizeRegistryGitHubEnvironment,
} from "./registry-access.mjs";

const DELIVERY_TYPE = "github-release-asset";
const ACCESS_CONTRACT = "registry-access-v1";
const DEFAULT_DIAGNOSTIC_LIMIT = 16 * 1024;

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

export function createGitHubCliStreamCommandRunner({
  spawnImpl,
  maxDiagnosticBytes = DEFAULT_DIAGNOSTIC_LIMIT,
} = {}) {
  if (typeof spawnImpl !== "function") return null;
  if (!Number.isSafeInteger(maxDiagnosticBytes) || maxDiagnosticBytes <= 0) return null;

  return async ({ command, args, env, timeoutMs }) => {
    let child;
    try {
      child = spawnImpl(command, [...args], {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return { kind: "transport-error" };
    }

    if (!child || !child.stdout || typeof child.once !== "function" || typeof child.kill !== "function") {
      try { child?.kill?.(); } catch {}
      return { kind: "transport-error" };
    }

    let stderr = "";
    if (child.stderr && typeof child.stderr.on === "function") {
      child.stderr.on("data", (chunk) => {
        if (stderr.length >= maxDiagnosticBytes) return;
        stderr += String(chunk).slice(0, maxDiagnosticBytes - stderr.length);
      });
    }

    const completion = new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(value);
      };
      const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try { child.kill(); } catch {}
          }, timeoutMs)
        : null;

      child.once("error", (error) => {
        if (error?.code === "ENOENT") {
          finish({ kind: "not-found" });
          return;
        }
        if (timedOut || error?.code === "ETIMEDOUT") {
          finish({ kind: "timeout" });
          return;
        }
        finish({ kind: "transport-error" });
      });
      child.once("close", (code) => {
        if (timedOut) {
          finish({ kind: "timeout" });
          return;
        }
        finish({
          kind: "completed",
          exitCode: Number.isInteger(code) ? code : 1,
          stderr,
        });
      });
    });

    return {
      kind: "started",
      stdout: child.stdout,
      completion,
      abort: () => {
        try { return child.kill(); } catch { return false; }
      },
    };
  };
}

export async function openGitHubReleaseAssetStream(resolvedTarget, {
  runner,
  streamRunner,
  environment = {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  if (typeof runner !== "function" || typeof streamRunner !== "function") {
    throw new RegistryArtifactDeliveryError("configuration-error", "text and stream GitHub CLI runners are required");
  }

  const resolvedAsset = await resolveGitHubReleaseAsset(resolvedTarget, {
    runner,
    environment,
    artifactRepository,
    timeoutMs,
  });
  const env = sanitizeRegistryGitHubEnvironment(environment);
  const started = await streamRunner({
    command: "gh",
    args: ["api", resolvedAsset.assetApiPath, "-H", "Accept: application/octet-stream"],
    env,
    timeoutMs,
  });
  if (started?.kind !== "started" || !started.stdout || !started.completion || typeof started.abort !== "function") {
    throw commandFailure("download-start-failed", "exact GitHub release asset stream could not be started", started);
  }

  const completed = Promise.resolve(started.completion).then((outcome) => {
    if (outcome?.kind !== "completed" || outcome.exitCode !== 0) {
      throw commandFailure("download-failed", "exact GitHub release asset retrieval failed", outcome);
    }
    return freeze({ exitCode: 0 });
  });

  return freeze({
    packageId: resolvedAsset.packageId,
    version: resolvedAsset.version,
    targetKey: resolvedAsset.targetKey,
    repository: resolvedAsset.repository,
    expectedTag: resolvedAsset.expectedTag,
    releaseId: resolvedAsset.releaseId,
    assetId: resolvedAsset.assetId,
    backendAssetName: resolvedAsset.backendAssetName,
    backendAssetSize: resolvedAsset.backendAssetSize,
    identity: resolvedAsset.identity,
    stream: started.stdout,
    completed,
    abort: started.abort,
  });
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

export async function openGitHubReleaseAssetStreamWithGitHubCli(resolvedTarget, {
  execFileImpl,
  spawnImpl,
  environment = globalThis.process?.env ?? {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const runner = createGitHubCliCommandRunner({ execFileImpl });
  const streamRunner = createGitHubCliStreamCommandRunner({ spawnImpl });
  if (!runner || !streamRunner) {
    throw new RegistryArtifactDeliveryError("configuration-error", "execFileImpl and spawnImpl are required");
  }
  return openGitHubReleaseAssetStream(resolvedTarget, {
    runner,
    streamRunner,
    environment,
    artifactRepository,
    timeoutMs,
  });
}
