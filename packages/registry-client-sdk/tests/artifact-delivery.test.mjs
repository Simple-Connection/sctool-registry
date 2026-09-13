import { Readable } from "node:stream";

import {
  RegistryArtifactDeliveryError,
  createGitHubCliStreamCommandRunner,
  deriveExpectedReleaseTag,
  openGitHubReleaseAssetStream,
  openGitHubReleaseAssetStreamWithGitHubCli,
  resolveGitHubReleaseAsset,
} from "@simple-connection/sctool-registry-client-sdk/artifact-delivery";

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}
function truthy(value, label) { if (!value) throw new Error(label); }
async function errorCode(fn, expected, label) {
  let actual = null;
  try { await fn(); } catch (error) {
    if (!(error instanceof RegistryArtifactDeliveryError)) throw error;
    actual = error.code;
  }
  equal(actual, expected, label);
}

function target(overrides = {}) {
  const base = {
    packageId: "example-tool",
    version: "1.2.3",
    targetKey: "win-x64",
    deliveryPlan: {
      currentDefaultVersion: "1.2.3",
      isCurrentDefaultVersion: true,
      preferredSource: "cache",
      fallbackSource: "origin",
    },
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-public-integrity-v1" },
      origin: { repository: "ExamplePublisher/example-tool", releaseId: 10, assetId: 101 },
      cache: { repository: "Simple-Connection/sctool-artifacts", releaseId: 20, assetId: 201 },
    },
  };
  return {
    ...base,
    ...overrides,
    deliveryPlan: { ...base.deliveryPlan, ...(overrides.deliveryPlan ?? {}) },
    delivery: {
      ...base.delivery,
      ...(overrides.delivery ?? {}),
      access: { ...base.delivery.access, ...(overrides.delivery?.access ?? {}) },
      origin: { ...base.delivery.origin, ...(overrides.delivery?.origin ?? {}) },
      ...(overrides.delivery && Object.prototype.hasOwnProperty.call(overrides.delivery, "cache")
        ? { cache: overrides.delivery.cache }
        : { cache: { ...base.delivery.cache } }),
    },
  };
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, body: null, async json() { return payload; } };
}
function binaryResponse(bytes, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: status >= 200 && status < 300 ? Readable.toWeb(Readable.from([bytes])) : null,
    async json() { throw new Error("not json"); },
  };
}

function harness(options = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    requests.push({ url: value, init });
    if (value.endsWith("/repos/Simple-Connection/sctool-artifacts/releases/20")) {
      if (options.cacheReleaseStatus) return jsonResponse({}, options.cacheReleaseStatus);
      return jsonResponse({
        id: options.cacheReleaseId ?? 20,
        tag_name: "cache-tag-is-observation-only",
        draft: false,
        assets: options.cacheAssets ?? [{ id: 201, name: "example.sctool", size: 4 }],
      });
    }
    if (value.endsWith("/repos/ExamplePublisher/example-tool/releases/10")) {
      if (options.originReleaseStatus) return jsonResponse({}, options.originReleaseStatus);
      return jsonResponse({
        id: options.originReleaseId ?? 10,
        tag_name: "publisher-custom-tag",
        draft: false,
        assets: options.originAssets ?? [{ id: 101, name: "example.sctool", size: 4 }],
      });
    }
    if (value.endsWith("/repos/Simple-Connection/sctool-artifacts/releases/assets/201")) {
      return binaryResponse(Buffer.from([0, 1, 2, 3]), options.cacheAssetStatus ?? 200);
    }
    if (value.endsWith("/repos/ExamplePublisher/example-tool/releases/assets/101")) {
      return binaryResponse(Buffer.from([4, 5, 6, 7]), options.originAssetStatus ?? 200);
    }
    throw new Error(`unexpected fetch ${value}`);
  };
  return { fetchImpl, requests };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

equal(deriveExpectedReleaseTag("example-tool", "1.2.3"), "sctool/example-tool/v1.2.3", "legacy tag helper remains deterministic");

const h = harness();
const preferred = await resolveGitHubReleaseAsset(target(), { fetchImpl: h.fetchImpl });
equal(preferred.source, "cache", "current preferred source is cache");
equal(preferred.releaseId, 20, "cache exact release id");
equal(preferred.assetId, 201, "cache exact asset id");
equal(preferred.backendTag, "cache-tag-is-observation-only", "tag retained only as observation");
truthy(h.requests[0].url.endsWith("/releases/20"), "release resolved by exact id");
equal(h.requests[0].url.includes("/releases/tags/"), false, "tag lookup forbidden");
equal("Authorization" in h.requests[0].init.headers, false, "public request has no authorization header");

const originH = harness();
const origin = await resolveGitHubReleaseAsset(target(), { source: "origin", fetchImpl: originH.fetchImpl });
equal(origin.source, "origin", "origin source selected");
equal(origin.repository, "ExamplePublisher/example-tool", "publisher repository accepted");
equal(origin.releaseId, 10, "origin exact release id");
equal(origin.assetId, 101, "origin exact asset id");

await errorCode(
  () => resolveGitHubReleaseAsset(target({
    deliveryPlan: { isCurrentDefaultVersion: false, preferredSource: "origin", fallbackSource: null },
  }), { source: "cache", fetchImpl: harness().fetchImpl }),
  "historical-cache-forbidden",
  "historical cache selection rejected",
);

await errorCode(
  () => resolveGitHubReleaseAsset(target({
    delivery: { cache: { repository: "OtherOrg/cache", releaseId: 20, assetId: 201 } },
  }), { fetchImpl: harness().fetchImpl }),
  "repository-mismatch",
  "cache repository mismatch",
);

await errorCode(
  () => resolveGitHubReleaseAsset(target({
    delivery: { access: { contract: "registry-access-v1" } },
  }), { fetchImpl: harness().fetchImpl }),
  "unsupported-access-contract",
  "legacy private access contract rejected",
);

await errorCode(
  () => resolveGitHubReleaseAsset(target(), { fetchImpl: harness({ cacheReleaseId: 999 }).fetchImpl }),
  "release-id-mismatch",
  "release id mismatch rejected",
);

await errorCode(
  () => resolveGitHubReleaseAsset(target(), { fetchImpl: harness({ cacheAssets: [] }).fetchImpl }),
  "asset-not-found",
  "missing exact cache asset rejected",
);

const streamH = harness();
const opened = await openGitHubReleaseAssetStream(target(), { fetchImpl: streamH.fetchImpl });
equal(opened.source, "cache", "stream source preserved");
equal(opened.releaseId, 20, "stream exact release preserved");
const bytes = await readAll(opened.stream);
await opened.completed;
equal(bytes.length, 4, "cache stream bytes");
truthy(streamH.requests[1].url.endsWith("/releases/assets/201"), "exact cache asset API used");

const compatH = harness();
const compat = await openGitHubReleaseAssetStreamWithGitHubCli(target(), { source: "origin", fetchImpl: compatH.fetchImpl });
await readAll(compat.stream);
await compat.completed;
equal(compat.source, "origin", "compat wrapper delegates to exact public origin transport");
equal(createGitHubCliStreamCommandRunner(), null, "legacy CLI stream runner disabled");

console.log("Registry Client SDK exact origin/cache artifact delivery PASS cases=22");
