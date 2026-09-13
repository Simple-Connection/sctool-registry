import { Readable } from "node:stream";

import {
  DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} from "./registry-access.mjs";

const DELIVERY_TYPE = "github-release-asset";
const ACCESS_CONTRACT = "registry-public-integrity-v1";
const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "sctool-registry-client-sdk";

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

function requireFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new RegistryArtifactDeliveryError(
      "configuration-error",
      "public artifact retrieval requires a fetch implementation",
    );
  }
  return fetchImpl;
}

function requireTimeout(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RegistryArtifactDeliveryError("configuration-error", "timeoutMs must be positive");
  }
  return timeoutMs;
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

function publicHeaders(accept) {
  return {
    Accept: accept,
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function transportFailure(code, message, error, details = {}) {
  if (error instanceof RegistryArtifactDeliveryError) return error;
  return new RegistryArtifactDeliveryError(code, message, {
    ...details,
    cause: error?.name ?? null,
  });
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs, code, message) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new RegistryArtifactDeliveryError("network-timeout", message, { url });
    }
    throw transportFailure(code, message, error, { url });
  } finally {
    clearTimeout(timer);
  }
}

export function deriveExpectedReleaseTag(packageId, version) {
  requireString(packageId, "invalid-package-id", "packageId");
  requireString(version, "invalid-version", "version");
  return `sctool/${packageId}/v${version}`;
}

export async function resolveGitHubReleaseAsset(resolvedTarget, {
  fetchImpl = globalThis.fetch,
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const fetcher = requireFetch(fetchImpl);
  requireTimeout(timeoutMs);
  const target = validateResolvedTarget(resolvedTarget, artifactRepository);
  const expectedTag = deriveExpectedReleaseTag(target.packageId, target.version);
  const url = `${GITHUB_API_BASE}/repos/${target.repository}/releases/tags/${encodeURIComponent(expectedTag)}`;

  const response = await fetchWithTimeout(
    fetcher,
    url,
    {
      method: "GET",
      headers: publicHeaders("application/vnd.github+json"),
      redirect: "follow",
    },
    timeoutMs,
    "release-query-failed",
    "expected public GitHub release could not be resolved",
  );

  if (!response?.ok) {
    throw new RegistryArtifactDeliveryError(
      "release-query-failed",
      "expected public GitHub release could not be resolved",
      { status: response?.status ?? null, expectedTag },
    );
  }

  let release;
  try {
    release = await response.json();
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
    assetApiUrl: `${GITHUB_API_BASE}/repos/${target.repository}/releases/assets/${target.assetId}`,
    identity: null,
  });
}

export async function openGitHubReleaseAssetStream(resolvedTarget, {
  fetchImpl = globalThis.fetch,
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const fetcher = requireFetch(fetchImpl);
  requireTimeout(timeoutMs);

  const resolvedAsset = await resolveGitHubReleaseAsset(resolvedTarget, {
    fetchImpl: fetcher,
    artifactRepository,
    timeoutMs,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetcher(resolvedAsset.assetApiUrl, {
      method: "GET",
      headers: publicHeaders("application/octet-stream"),
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === "AbortError") {
      throw new RegistryArtifactDeliveryError("network-timeout", "public GitHub release asset download timed out", {
        assetId: resolvedAsset.assetId,
      });
    }
    throw transportFailure(
      "download-start-failed",
      "exact public GitHub release asset stream could not be started",
      error,
      { assetId: resolvedAsset.assetId },
    );
  }

  if (!response?.ok || !response.body) {
    clearTimeout(timer);
    throw new RegistryArtifactDeliveryError(
      "download-start-failed",
      "exact public GitHub release asset stream could not be started",
      { status: response?.status ?? null, assetId: resolvedAsset.assetId },
    );
  }

  let stream;
  try {
    stream = Readable.fromWeb(response.body);
  } catch (error) {
    clearTimeout(timer);
    throw transportFailure(
      "download-start-failed",
      "public GitHub release asset response body is not streamable",
      error,
      { assetId: resolvedAsset.assetId },
    );
  }

  let settled = false;
  const completed = new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    stream.once("end", () => finish(resolve, freeze({ exitCode: 0 })));
    stream.once("error", (error) => finish(
      reject,
      transportFailure("download-failed", "exact public GitHub release asset retrieval failed", error, {
        assetId: resolvedAsset.assetId,
      }),
    ));
  });

  const abort = () => {
    if (!settled) {
      controller.abort();
      try { stream.destroy(); } catch {}
      clearTimeout(timer);
    }
    return true;
  };

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
    identity: null,
    stream,
    completed,
    abort,
  });
}

/**
 * @deprecated Public cache retrieval no longer uses GitHub CLI. This compatibility
 * wrapper delegates to the public HTTP transport and never performs gh auth.
 */
export async function resolveGitHubReleaseAssetWithGitHubCli(resolvedTarget, options = {}) {
  return resolveGitHubReleaseAsset(resolvedTarget, {
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    artifactRepository: options.artifactRepository,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * @deprecated Public cache retrieval no longer uses GitHub CLI. This compatibility
 * wrapper delegates to the public HTTP transport and never performs gh auth.
 */
export async function openGitHubReleaseAssetStreamWithGitHubCli(resolvedTarget, options = {}) {
  return openGitHubReleaseAssetStream(resolvedTarget, {
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    artifactRepository: options.artifactRepository,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * @deprecated Streaming subprocess transport is retained only as a compatibility
 * symbol. Public artifact retrieval does not use it.
 */
export function createGitHubCliStreamCommandRunner() {
  return null;
}
