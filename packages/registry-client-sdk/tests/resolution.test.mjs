import {
  RegistryResolutionError,
  deriveTargetKey,
  resolvePackageTarget,
  resolvePackageVersion,
} from "@simple-connection/sctool-registry-client-sdk/resolution";

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}
function truthy(value, label) { if (!value) throw new Error(label); }
function requireCode(fn, expected, label) {
  let actual = null;
  try { fn(); } catch (error) {
    if (!(error instanceof RegistryResolutionError)) throw error;
    actual = error.code;
  }
  equal(actual, expected, label);
}

function artifact(filename, digestChar, size, originReleaseId, originAssetId, platform, arch, cache = null) {
  return {
    target: { platform, arch },
    content: { filename, sha256: digestChar.repeat(64), size },
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-public-integrity-v1" },
      origin: {
        repository: "ExamplePublisher/example-tool",
        releaseId: originReleaseId,
        assetId: originAssetId,
      },
      ...(cache ? { cache } : {}),
    },
    publication: { marketplace: true, publicRedistribution: cache !== null },
    publishedAt: "2026-09-03T00:00:00Z",
    contract: { sctoolSpecVersion: "1.0.0" },
    signature: {
      algorithm: "ed25519",
      keyId: "example-key-1",
      scope: "sctool-submission-v2",
      submissionId: `submission-id-${originAssetId}`,
      submittedAt: "2026-09-03T00:00:00Z",
      sdkVersion: "0.2.0",
      value: "QUJDRA==",
    },
  };
}

const descriptor = {
  schemaVersion: "3.0.0",
  id: "example-tool",
  publisher: "Example.Publisher",
  defaultChannel: "stable",
  channels: {
    stable: "1.2.3",
    beta: "1.3.0-beta.1",
  },
  versions: {
    "1.1.0": {
      artifacts: {
        "win-x64": artifact("example-tool-1.1.0-win-x64.sctool", "d", 90, 40, 90, "win", "x64"),
      },
    },
    "1.2.3": {
      artifacts: {
        "win-x64": artifact(
          "example-tool-1.2.3-win-x64.sctool", "a", 100, 55, 101, "win", "x64",
          { repository: "Simple-Connection/sctool-artifacts", releaseId: 77, assetId: 201 },
        ),
        "linux-x64": artifact(
          "example-tool-1.2.3-linux-x64.sctool", "b", 200, 56, 102, "linux", "x64",
          { repository: "Simple-Connection/sctool-artifacts", releaseId: 78, assetId: 202 },
        ),
      },
    },
    "1.3.0-beta.1": {
      artifacts: {
        "win-x64": artifact("example-tool-1.3.0-beta.1-win-x64.sctool", "c", 300, 57, 103, "win", "x64"),
      },
    },
  },
};

equal(deriveTargetKey("win", "x64"), "win-x64", "target key");
requireCode(() => deriveTargetKey("Win", "x64"), "invalid-platform", "invalid platform");

const stable = resolvePackageVersion(descriptor);
equal(stable.version, "1.2.3", "default version");
equal(stable.currentDefaultVersion, "1.2.3", "current default identity");
equal(stable.isCurrentDefaultVersion, true, "stable current classification");

const explicitCurrent = resolvePackageVersion(descriptor, { version: "1.2.3" });
equal(explicitCurrent.channel, null, "explicit version no channel authority");
equal(explicitCurrent.isCurrentDefaultVersion, true, "explicit current still classified current");

const beta = resolvePackageVersion(descriptor, { channel: "beta" });
equal(beta.version, "1.3.0-beta.1", "beta version");
equal(beta.isCurrentDefaultVersion, false, "alternate channel not default current");

const currentTarget = resolvePackageTarget(descriptor, { platform: "win", arch: "x64" });
equal(currentTarget.deliveryPlan.preferredSource, "cache", "current prefers cache");
equal(currentTarget.deliveryPlan.fallbackSource, "origin", "current cache falls back origin");
equal(currentTarget.delivery.cache.releaseId, 77, "cache release identity preserved");
equal(currentTarget.delivery.origin.releaseId, 55, "origin release identity preserved");
equal(currentTarget.publication.publicRedistribution, true, "redistribution evidence preserved");

const betaTarget = resolvePackageTarget(descriptor, { channel: "beta", platform: "win", arch: "x64" });
equal(betaTarget.deliveryPlan.preferredSource, "origin", "alternate channel uses origin");
equal(betaTarget.deliveryPlan.fallbackSource, null, "alternate channel has no cache fallback");

const historical = resolvePackageTarget(descriptor, { version: "1.1.0", platform: "win", arch: "x64" });
equal(historical.deliveryPlan.preferredSource, "origin", "historical uses origin only");
equal(historical.deliveryPlan.fallbackSource, null, "historical has no fallback");
equal("cache" in historical.delivery, false, "historical descriptor has no cache");

requireCode(
  () => resolvePackageVersion(descriptor, { channel: "stable", version: "1.2.3" }),
  "ambiguous-version-selector",
  "ambiguous selector",
);
requireCode(() => resolvePackageVersion(descriptor, { channel: "nightly" }), "channel-not-found", "missing channel");
requireCode(() => resolvePackageTarget(descriptor, { platform: "darwin", arch: "arm64" }), "target-not-found", "missing target");
truthy(Object.isFrozen(currentTarget.deliveryPlan), "delivery plan frozen");

console.log("Registry Client SDK resolution v3 PASS cases=20");
