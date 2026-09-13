import { createHash } from "node:crypto";
import { Readable } from "node:stream";

export const artifactBytes = Buffer.from("candidate-bytes");
export const artifactDigest = createHash("sha256").update(artifactBytes).digest("hex");

export function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}
export function truthy(value, label) { if (!value) throw new Error(label); }

export async function errorCode(fn, ErrorType, expected, label) {
  let actual = null;
  try { await fn(); } catch (error) {
    if (!(error instanceof ErrorType)) throw error;
    actual = error.code;
  }
  equal(actual, expected, label);
}

export async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function makeTarget(overrides = {}) {
  const base = {
    packageId: "example-tool",
    channel: "stable",
    version: "1.2.3",
    targetKey: "win-x64",
    target: { platform: "win", arch: "x64" },
    content: {
      filename: "example-tool.sctool",
      sha256: artifactDigest,
      size: artifactBytes.length,
    },
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-public-integrity-v1" },
      origin: {
        repository: "ExamplePublisher/example-tool",
        releaseId: 55,
        assetId: 101,
      },
      cache: {
        repository: "Simple-Connection/sctool-artifacts",
        releaseId: 77,
        assetId: 201,
      },
    },
    publication: { marketplace: true, publicRedistribution: true },
    deliveryPlan: {
      currentDefaultVersion: "1.2.3",
      isCurrentDefaultVersion: true,
      preferredSource: "cache",
      fallbackSource: "origin",
    },
    publishedAt: "2026-09-06T00:00:00Z",
    contract: { sctoolSpecVersion: "1.0.0" },
  };

  return {
    ...base,
    ...overrides,
    target: { ...base.target, ...(overrides.target ?? {}) },
    content: { ...base.content, ...(overrides.content ?? {}) },
    delivery: {
      ...base.delivery,
      ...(overrides.delivery ?? {}),
      access: { ...base.delivery.access, ...(overrides.delivery?.access ?? {}) },
      origin: { ...base.delivery.origin, ...(overrides.delivery?.origin ?? {}) },
      ...(
        overrides.delivery && Object.prototype.hasOwnProperty.call(overrides.delivery, "cache")
          ? { cache: overrides.delivery.cache }
          : { cache: { ...base.delivery.cache } }
      ),
    },
    publication: { ...base.publication, ...(overrides.publication ?? {}) },
    deliveryPlan: { ...base.deliveryPlan, ...(overrides.deliveryPlan ?? {}) },
    contract: { ...base.contract, ...(overrides.contract ?? {}) },
  };
}

export function observation(installedVersion, overrides = {}) {
  return {
    authority: "AUTH_SIMPLE_CONNECTION_DESKTOP",
    packageId: "example-tool",
    targetKey: "win-x64",
    installedVersion,
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    async json() { return payload; },
  };
}

function binaryResponse(chunks, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: status >= 200 && status < 300 ? Readable.toWeb(Readable.from(chunks)) : null,
    async json() { throw new Error("binary response has no JSON"); },
  };
}

export function createRetrievalHarness(target = makeTarget(), options = {}) {
  const counters = {
    textRequests: 0,
    releaseQueries: 0,
    cacheReleaseQueries: 0,
    originReleaseQueries: 0,
    assetStreams: 0,
    cacheAssetStreams: 0,
    originAssetStreams: 0,
  };
  const requests = [];

  const cache = target.delivery.cache;
  const origin = target.delivery.origin;

  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    counters.textRequests += 1;
    requests.push({ url: value, init });

    if (cache && value.endsWith(`/repos/${cache.repository}/releases/${cache.releaseId}`)) {
      counters.releaseQueries += 1;
      counters.cacheReleaseQueries += 1;
      if (options.cacheReleaseStatus) return jsonResponse({ message: "cache unavailable" }, options.cacheReleaseStatus);
      return jsonResponse({
        id: cache.releaseId,
        tag_name: "cache-observation-tag",
        draft: false,
        assets: [{
          id: cache.assetId,
          name: target.content.filename,
          size: target.content.size,
        }],
      });
    }

    if (value.endsWith(`/repos/${origin.repository}/releases/${origin.releaseId}`)) {
      counters.releaseQueries += 1;
      counters.originReleaseQueries += 1;
      if (options.originReleaseStatus) return jsonResponse({ message: "origin unavailable" }, options.originReleaseStatus);
      return jsonResponse({
        id: origin.releaseId,
        tag_name: "publisher-defined-tag",
        draft: false,
        assets: [{
          id: origin.assetId,
          name: target.content.filename,
          size: target.content.size,
        }],
      });
    }

    if (cache && value.endsWith(`/repos/${cache.repository}/releases/assets/${cache.assetId}`)) {
      counters.assetStreams += 1;
      counters.cacheAssetStreams += 1;
      if (options.cacheAssetStatus) return binaryResponse([], options.cacheAssetStatus);
      const cacheBytes = options.corruptCache
        ? Buffer.from("corrupt-cache-bytes")
        : artifactBytes;
      return binaryResponse([cacheBytes.subarray(0, 4), cacheBytes.subarray(4)]);
    }

    if (value.endsWith(`/repos/${origin.repository}/releases/assets/${origin.assetId}`)) {
      counters.assetStreams += 1;
      counters.originAssetStreams += 1;
      if (options.originAssetStatus) return binaryResponse([], options.originAssetStatus);
      const originBytes = options.corruptOrigin
        ? Buffer.from("corrupt-origin-bytes")
        : artifactBytes;
      return binaryResponse([originBytes.subarray(0, 4), originBytes.subarray(4)]);
    }

    throw new Error(`unexpected public fetch ${value}`);
  };

  return { counters, requests, fetchImpl };
}
