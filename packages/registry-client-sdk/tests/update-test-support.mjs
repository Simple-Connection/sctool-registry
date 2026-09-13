import { createHash } from "node:crypto";
import { Readable } from "node:stream";

export const artifactBytes = Buffer.from("candidate-bytes");
export const artifactDigest = createHash("sha256").update(artifactBytes).digest("hex");

export function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected=${expected} actual=${actual}`);
  }
}

export function truthy(value, label) {
  if (!value) throw new Error(label);
}

export async function errorCode(fn, ErrorType, expected, label) {
  let actual = null;
  try {
    await fn();
  } catch (error) {
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
      locator: {
        repository: "Simple-Connection/sctool-artifacts",
        assetId: 101,
      },
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
      access: {
        ...base.delivery.access,
        ...(overrides.delivery?.access ?? {}),
      },
      locator: {
        ...base.delivery.locator,
        ...(overrides.delivery?.locator ?? {}),
      },
    },
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
    async json() {
      return payload;
    },
  };
}

function binaryResponse(chunks, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: Readable.toWeb(Readable.from(chunks)),
    async json() {
      throw new Error("binary response has no JSON body");
    },
  };
}

export function createRetrievalHarness(target = makeTarget()) {
  const counters = {
    textRequests: 0,
    releaseQueries: 0,
    assetStreams: 0,
  };
  const requests = [];

  const fetchImpl = async (url, init = {}) => {
    counters.textRequests += 1;
    requests.push({ url: String(url), init });

    if (String(url).includes("/releases/tags/")) {
      counters.releaseQueries += 1;
      return jsonResponse({
        id: 55,
        tag_name: `sctool/${target.packageId}/v${target.version}`,
        draft: false,
        assets: [{
          id: target.delivery.locator.assetId,
          name: target.content.filename,
          size: target.content.size,
        }],
      });
    }

    if (String(url).endsWith(`/releases/assets/${target.delivery.locator.assetId}`)) {
      counters.assetStreams += 1;
      return binaryResponse([
        artifactBytes.subarray(0, 4),
        artifactBytes.subarray(4),
      ]);
    }

    throw new Error(`unexpected public fetch ${url}`);
  };

  return { counters, requests, fetchImpl };
}
