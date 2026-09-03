import {
  RegistryResolutionError,
  deriveTargetKey,
  resolvePackageTarget,
  resolvePackageVersion,
} from "@simple-connection/sctool-registry-client-sdk/resolution";

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}

function assertCondition(condition, label) {
  if (!condition) throw new Error(label);
}

function requireResolutionCode(fn, expectedCode, label) {
  let actualCode = null;
  try {
    fn();
  } catch (error) {
    if (!(error instanceof RegistryResolutionError)) throw error;
    actualCode = error.code;
  }
  requireEqual(actualCode, expectedCode, label);
}

function artifact(filename, sha, size, assetId, platform, arch) {
  return {
    target: { platform, arch },
    content: { filename, sha256: sha.repeat(64), size },
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-access-v1" },
      locator: { repository: "Simple-Connection/sctool-artifacts", assetId },
    },
    publishedAt: "2026-09-03T00:00:00Z",
    contract: { sctoolSpecVersion: "1.0.0" },
    signature: {
      algorithm: "ed25519",
      keyId: "example-key-1",
      scope: "sctool-submission-v1",
      submissionId: `submission-id-${assetId}`,
      submittedAt: "2026-09-03T00:00:00Z",
      sdkVersion: "0.1.0",
      value: "QUJDRA==",
    },
  };
}

const descriptor = {
  schemaVersion: "2.0.0",
  id: "example-tool",
  publisher: "Example.Publisher",
  defaultChannel: "stable",
  channels: {
    stable: "1.2.3",
    beta: "1.3.0-beta.1",
  },
  versions: {
    "1.2.3": {
      artifacts: {
        "win-x64": artifact("example-tool-1.2.3-win-x64.sctool", "a", 100, 101, "win", "x64"),
        "linux-x64": artifact("example-tool-1.2.3-linux-x64.sctool", "b", 200, 102, "linux", "x64"),
      },
    },
    "1.3.0-beta.1": {
      artifacts: {
        "win-x64": artifact("example-tool-1.3.0-beta.1-win-x64.sctool", "c", 300, 103, "win", "x64"),
      },
    },
  },
};

requireEqual(deriveTargetKey("win", "x64"), "win-x64", "target key");
requireResolutionCode(() => deriveTargetKey("Win", "x64"), "invalid-platform", "invalid platform");
requireResolutionCode(() => deriveTargetKey("win", "x86_64"), "invalid-arch", "invalid arch");

const stable = resolvePackageVersion(descriptor);
requireEqual(stable.channel, "stable", "default channel");
requireEqual(stable.version, "1.2.3", "default version");

const beta = resolvePackageVersion(descriptor, { channel: "beta" });
requireEqual(beta.channel, "beta", "explicit channel");
requireEqual(beta.version, "1.3.0-beta.1", "explicit channel version");

const explicit = resolvePackageVersion(descriptor, { version: "1.2.3" });
requireEqual(explicit.channel, null, "explicit version has no channel authority");
requireEqual(explicit.version, "1.2.3", "explicit version");

requireResolutionCode(
  () => resolvePackageVersion(descriptor, { channel: "stable", version: "1.2.3" }),
  "ambiguous-version-selector",
  "ambiguous selector",
);
requireResolutionCode(() => resolvePackageVersion(descriptor, { channel: "nightly" }), "channel-not-found", "missing channel");
requireResolutionCode(() => resolvePackageVersion(descriptor, { version: "9.9.9" }), "version-not-found", "missing version");

const resolved = resolvePackageTarget(descriptor, { platform: "win", arch: "x64" });
requireEqual(resolved.packageId, "example-tool", "resolved package id");
requireEqual(resolved.channel, "stable", "resolved default channel");
requireEqual(resolved.version, "1.2.3", "resolved version");
requireEqual(resolved.targetKey, "win-x64", "resolved target key");
requireEqual(resolved.content.filename, "example-tool-1.2.3-win-x64.sctool", "content filename authority");
requireEqual(resolved.content.size, 100, "content size authority");
requireEqual(resolved.delivery.type, "github-release-asset", "delivery discriminator authority");
requireEqual(resolved.delivery.locator.assetId, 101, "delivery asset id preservation");
assertCondition(Object.isFrozen(resolved.content), "resolved content must remain frozen");

const betaTarget = resolvePackageTarget(descriptor, { channel: "beta", platform: "win", arch: "x64" });
requireEqual(betaTarget.version, "1.3.0-beta.1", "beta target version");
requireEqual(betaTarget.content.size, 300, "beta target content size");

requireResolutionCode(
  () => resolvePackageTarget(descriptor, { platform: "darwin", arch: "arm64" }),
  "target-not-found",
  "missing target",
);

console.log("Registry Client SDK resolution PASS cases=20");
