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

function requirePositiveId(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RegistryArtifactDeliveryError(
      `invalid-${field}`,
      `${field} must be a positive safe integer`,
      { field, value: value ?? null },
    );
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

function validateDeliveryEnvelope(resolvedTarget) {
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
  return { packageId, version, delivery };
}

function selectLocator(resolvedTarget, requestedSource, artifactRepository) {
  const { packageId, version, delivery } = validateDeliveryEnvelope(resolvedTarget);
  const planned = resolvedTarget.deliveryPlan?.preferredSource;
  const source = requestedSource === undefined || requestedSource === "preferred"
    ? (planned ?? (delivery.cache ? "cache" : "origin"))
    : requestedSource;

  if (source !== "cache" && source !== "origin") {
    throw new RegistryArtifactDeliveryError("invalid-delivery-source", "delivery source must be cache or origin", {
      source,
    });
  }
  if (source === "cache" && resolvedTarget.deliveryPlan?.isCurrentDefaultVersion !== true) {
    throw new RegistryArtifactDeliveryError(
      "historical-cache-forbidden",
      "central cache cannot be selected for a non-current version",
      { version },
    );
  }

  const locator = delivery[source];
  if (!locator || typeof locator !== "object") {
    throw new RegistryArtifactDeliveryError("delivery-source-unavailable", `${source} locator is not available`, {
      source,
      version,
    });
  }

  const repository = requireString(locator.repository, "invalid-repository", `delivery.${source}.repository`);
  if (source === "cache" && repository !== artifactRepository) {
    throw new RegistryArtifactDeliveryError("repository-mismatch", "cache repository does not match Registry policy", {
      source,
      repository,
      expectedRepository: artifactRepository,
    });
  }

  return freeze({
    packageId,
    version,
    targetKey: resolvedTarget.targetKey ?? null,
    source,
    repository,
    releaseId: requirePositiveId(locator.releaseId, "release-id"),
    assetId: requirePositiveId(locator.assetId, "asset-id"),
  });
}

/**
 * @deprecated Release tags are no longer locator authority in package schema v3.
 * This helper remains only for compatibility with legacy callers.
 */
export function deriveExpectedReleaseTag(packageId, version) {
  requireString(packageId, "invalid-package-id", "packageId");
  requireString(version, "invalid-version", "version");
  return `sctool/${packageId}/v${version}`;
}

export async function resolveGitHubReleaseAsset(resolvedTarget, {
  source = "preferred",
  fetchImpl = globalThis.fetch,
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const fetcher = requireFetch(fetchImpl);
  requireTimeout(timeoutMs);
  const target = selectLocator(resolvedTarget, source, artifactRepository);
  const url = `${GITHUB_API_BASE}/repos/${target.repository}/releases/${target.releaseId}`;

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
    "exact public GitHub release could not be resolved",
  );

  if (!response?.ok) {
    throw new RegistryArtifactDeliveryError(
      "release-query-failed",
      "exact public GitHub release could not be resolved",
      {
        source: target.source,
        status: response?.status ?? null,
        repository: target.repository,
        releaseId: target.releaseId,
      },
    );
  }

  let release;
  try {
    release = await response.json();
  } catch {
    throw new RegistryArtifactDeliveryError("release-response-invalid", "GitHub release response is not valid JSON", {
      source: target.source,
    });
  }

  if (!release || typeof release !== "object" || release.id !== target.releaseId) {
    throw new RegistryArtifactDeliveryError("release-id-mismatch", "resolved GitHub release identity does not match locator", {
      source: target.source,
      expectedReleaseId: target.releaseId,
      actualReleaseId: release?.id ?? null,
    });
  }
  if (release.draft !== false) {
    throw new RegistryArtifactDeliveryError("release-draft", "draft GitHub releases cannot resolve Registry artifacts", {
      source: target.source,
      releaseId: target.releaseId,
    });
  }
  if (!Array.isArray(release.assets)) {
    throw new RegistryArtifactDeliveryError("release-response-invalid", "GitHub release assets are missing", {
      source: target.source,
      releaseId: target.releaseId,
    });
  }

  const matches = release.assets.filter((asset) => asset?.id === target.assetId);
  if (matches.length === 0) {
    throw new RegistryArtifactDeliveryError("asset-not-found", "delivery assetId is absent from the exact release", {
      source: target.source,
      releaseId: target.releaseId,
      assetId: target.assetId,
    });
  }
  if (matches.length !== 1) {
    throw new RegistryArtifactDeliveryError("asset-not-unique", "delivery assetId resolved more than once in the exact release", {
      source: target.source,
      releaseId: target.releaseId,
      assetId: target.assetId,
      matches: matches.length,
    });
  }

  const asset = matches[0];
  return freeze({
    packageId: target.packageId,
    version: target.version,
    targetKey: target.targetKey,
    source: target.source,
    repository: target.repository,
    releaseId: target.releaseId,
    assetId: target.assetId,
    backendTag: typeof release.tag_name === "string" ? release.tag_name : null,
    backendAssetName: typeof asset.name === "string" ? asset.name : null,
    backendAssetSize: Number.isSafeInteger(asset.size) ? asset.size : null,
    assetApiUrl: `${GITHUB_API_BASE}/repos/${target.repository}/releases/assets/${target.assetId}`,
    identity: null,
  });
}

export async function openGitHubReleaseAssetStream(resolvedTarget, {
  source = "preferred",
  fetchImpl = globalThis.fetch,
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const fetcher = requireFetch(fetchImpl);
  requireTimeout(timeoutMs);

  const resolvedAsset = await resolveGitHubReleaseAsset(resolvedTarget, {
    source,
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
        source: resolvedAsset.source,
        assetId: resolvedAsset.assetId,
      });
    }
    throw transportFailure(
      "download-start-failed",
      "exact public GitHub release asset stream could not be started",
      error,
      { source: resolvedAsset.source, assetId: resolvedAsset.assetId },
    );
  }

  if (!response?.ok || !response.body) {
    clearTimeout(timer);
    throw new RegistryArtifactDeliveryError(
      "download-start-failed",
      "exact public GitHub release asset stream could not be started",
      {
        source: resolvedAsset.source,
        status: response?.status ?? null,
        assetId: resolvedAsset.assetId,
      },
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
      { source: resolvedAsset.source, assetId: resolvedAsset.assetId },
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
        source: resolvedAsset.source,
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
    source: resolvedAsset.source,
    repository: resolvedAsset.repository,
    releaseId: resolvedAsset.releaseId,
    assetId: resolvedAsset.assetId,
    backendTag: resolvedAsset.backendTag,
    backendAssetName: resolvedAsset.backendAssetName,
    backendAssetSize: resolvedAsset.backendAssetSize,
    identity: null,
    stream,
    completed,
    abort,
  });
}

export async function resolveGitHubReleaseAssetWithGitHubCli(resolvedTarget, options = {}) {
  return resolveGitHubReleaseAsset(resolvedTarget, {
    source: options.source,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    artifactRepository: options.artifactRepository,
    timeoutMs: options.timeoutMs,
  });
}

export async function openGitHubReleaseAssetStreamWithGitHubCli(resolvedTarget, options = {}) {
  return openGitHubReleaseAssetStream(resolvedTarget, {
    source: options.source,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    artifactRepository: options.artifactRepository,
    timeoutMs: options.timeoutMs,
  });
}

/** @deprecated Public artifact retrieval does not use GitHub CLI subprocess streaming. */
export function createGitHubCliStreamCommandRunner() {
  return null;
}
