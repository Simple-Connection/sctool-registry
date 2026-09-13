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

function truthy(value, label) {
  if (!value) throw new Error(label);
}

async function errorCode(fn, expected, label) {
  let actual = null;
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof RegistryArtifactDeliveryError)) throw error;
    actual = error.code;
  }
  equal(actual, expected, label);
}

function target(overrides = {}) {
  return {
    packageId: "example-tool",
    version: "1.2.3",
    targetKey: "win-x64",
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-public-integrity-v1" },
      locator: {
        repository: "Simple-Connection/sctool-artifacts",
        assetId: 101,
      },
    },
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
      throw new Error("binary response has no JSON");
    },
  };
}

function publicFetchHarness({ release, bytes = Buffer.from([0, 1, 2, 255]), assetStatus = 200 } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/releases/tags/")) {
      return jsonResponse(release ?? {
        id: 55,
        tag_name: "sctool/example-tool/v1.2.3",
        draft: false,
        assets: [{ id: 101, name: "backend-observation.sctool", size: 999 }],
      });
    }
    if (String(url).endsWith("/releases/assets/101")) {
      return binaryResponse([bytes.subarray(0, 2), bytes.subarray(2)], assetStatus);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, requests };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

equal(deriveExpectedReleaseTag("example-tool", "1.2.3"), "sctool/example-tool/v1.2.3", "expected release tag");

await errorCode(
  () => resolveGitHubReleaseAsset(target({ delivery: { type: "other" } }), { fetchImpl: async () => null }),
  "unsupported-delivery",
  "unknown delivery fails closed",
);

await errorCode(
  () => resolveGitHubReleaseAsset(target({
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-public-integrity-v1" },
      locator: { repository: "Other/repo", assetId: 101 },
    },
  }), { fetchImpl: async () => null }),
  "repository-mismatch",
  "repository mismatch",
);

await errorCode(
  () => resolveGitHubReleaseAsset(target({
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-access-v1" },
      locator: { repository: "Simple-Connection/sctool-artifacts", assetId: 101 },
    },
  }), { fetchImpl: async () => null }),
  "unsupported-access-contract",
  "legacy private access contract rejected",
);

const success = publicFetchHarness();
const resolved = await resolveGitHubReleaseAsset(target(), { fetchImpl: success.fetchImpl });
equal(resolved.expectedTag, "sctool/example-tool/v1.2.3", "resolved expected tag");
equal(resolved.assetId, 101, "resolved exact asset id");
equal(resolved.backendAssetName, "backend-observation.sctool", "backend name observation");
equal(resolved.backendAssetSize, 999, "backend size observation");
equal(resolved.identity, null, "public transport has no GitHub identity authority");
truthy(success.requests[0].url.endsWith("sctool%2Fexample-tool%2Fv1.2.3"), "release endpoint uses encoded derived tag");
equal("Authorization" in success.requests[0].init.headers, false, "release query has no authorization header");

const draft = publicFetchHarness({
  release: { id: 55, tag_name: "sctool/example-tool/v1.2.3", draft: true, assets: [{ id: 101 }] },
});
await errorCode(() => resolveGitHubReleaseAsset(target(), { fetchImpl: draft.fetchImpl }), "release-draft", "draft release");

const missing = publicFetchHarness({
  release: { id: 55, tag_name: "sctool/example-tool/v1.2.3", draft: false, assets: [] },
});
await errorCode(() => resolveGitHubReleaseAsset(target(), { fetchImpl: missing.fetchImpl }), "asset-not-found", "missing exact asset");

const failedQuery = {
  fetchImpl: async () => jsonResponse({ message: "not found" }, 404),
};
await errorCode(
  () => resolveGitHubReleaseAsset(target(), { fetchImpl: failedQuery.fetchImpl }),
  "release-query-failed",
  "public release query failure",
);

const streamHarness = publicFetchHarness();
const opened = await openGitHubReleaseAssetStream(target(), { fetchImpl: streamHarness.fetchImpl });
equal(opened.packageId, "example-tool", "stream preserves package id");
equal(opened.releaseId, 55, "stream preserves release observation");
equal(opened.backendAssetName, "backend-observation.sctool", "stream preserves backend name");
equal(opened.backendAssetSize, 999, "stream preserves backend size");
const bytes = await readAll(opened.stream);
await opened.completed;
equal(bytes.length, 4, "streamed byte count");
equal(bytes[3], 255, "stream preserves binary bytes");
equal(streamHarness.requests[1].url.endsWith("/repos/Simple-Connection/sctool-artifacts/releases/assets/101"), true, "stream uses exact asset API URL");
equal(streamHarness.requests[1].init.headers.Accept, "application/octet-stream", "stream requests binary asset");
equal("Authorization" in streamHarness.requests[1].init.headers, false, "asset request has no authorization header");

const failedAsset = publicFetchHarness({ assetStatus: 404 });
await errorCode(
  () => openGitHubReleaseAssetStream(target(), { fetchImpl: failedAsset.fetchImpl }),
  "download-start-failed",
  "missing public asset fails closed",
);

const compat = publicFetchHarness();
const compatOpened = await openGitHubReleaseAssetStreamWithGitHubCli(target(), {
  fetchImpl: compat.fetchImpl,
});
await readAll(compatOpened.stream);
await compatOpened.completed;
equal(compat.requests.length, 2, "compatibility wrapper uses public HTTP only");
equal(createGitHubCliStreamCommandRunner(), null, "legacy CLI stream runner is disabled");

await errorCode(
  () => resolveGitHubReleaseAsset(target(), { fetchImpl: null }),
  "configuration-error",
  "missing public fetch fails closed",
);

console.log("Registry Client SDK public artifact delivery PASS cases=24");
