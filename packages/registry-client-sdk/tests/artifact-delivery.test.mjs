import {
  RegistryArtifactDeliveryError,
  createGitHubCliBinaryCommandRunner,
  deriveExpectedReleaseTag,
  resolveGitHubReleaseAsset,
  retrieveGitHubReleaseAsset,
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
      access: { contract: "registry-access-v1" },
      locator: {
        repository: "Simple-Connection/sctool-artifacts",
        assetId: 101,
      },
    },
    ...overrides,
  };
}

function authorizedRunner({ release } = {}) {
  const requests = [];
  const runner = async (request) => {
    requests.push(request);
    const args = request.args;
    if (args[0] === "--version") return { kind: "completed", exitCode: 0, stdout: "gh version 2\n", stderr: "" };
    if (args[0] === "auth" && args[1] === "status") return { kind: "completed", exitCode: 0, stdout: "", stderr: "" };
    if (args[0] === "api" && args[1] === "user") return { kind: "completed", exitCode: 0, stdout: "tester\n", stderr: "" };
    if (args[0] === "api" && args[1] === "repos/Simple-Connection/sctool-artifacts" && args[2] === "--silent") {
      return { kind: "completed", exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "api" && args[1].includes("/releases/tags/")) {
      return {
        kind: "completed",
        exitCode: 0,
        stdout: JSON.stringify(release ?? {
          id: 55,
          tag_name: "sctool/example-tool/v1.2.3",
          draft: false,
          assets: [{ id: 101, name: "backend-observation.sctool", size: 999 }],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${JSON.stringify(args)}`);
  };
  return { runner, requests };
}

equal(deriveExpectedReleaseTag("example-tool", "1.2.3"), "sctool/example-tool/v1.2.3", "expected release tag");
await errorCode(
  () => resolveGitHubReleaseAsset(target({ delivery: { type: "other" } }), { runner: async () => null }),
  "unsupported-delivery",
  "unknown delivery fails closed",
);
await errorCode(
  () => resolveGitHubReleaseAsset(target({
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-access-v1" },
      locator: { repository: "Other/repo", assetId: 101 },
    },
  }), { runner: async () => null }),
  "repository-mismatch",
  "repository mismatch",
);

const success = authorizedRunner();
const resolved = await resolveGitHubReleaseAsset(target(), {
  runner: success.runner,
  environment: { PATH: "x", GH_TOKEN: "forbidden", github_token: "forbidden2" },
});
equal(resolved.expectedTag, "sctool/example-tool/v1.2.3", "resolved expected tag");
equal(resolved.assetId, 101, "resolved exact asset id");
equal(resolved.backendAssetName, "backend-observation.sctool", "backend name is observation only");
equal(resolved.backendAssetSize, 999, "backend size is observation only");
equal(resolved.identity.login, "tester", "resolved access identity");
const releaseRequest = success.requests.at(-1);
truthy(releaseRequest.args[1].endsWith("sctool%2Fexample-tool%2Fv1.2.3"), "release endpoint uses encoded derived tag");
truthy(releaseRequest.args[3].includes("select(.id==101)"), "release query filters exact numeric asset id");
truthy(!("GH_TOKEN" in releaseRequest.env), "release query strips GH_TOKEN");
truthy(!("github_token" in releaseRequest.env), "release query strips case-insensitive github token");

const draft = authorizedRunner({
  release: { id: 55, tag_name: "sctool/example-tool/v1.2.3", draft: true, assets: [{ id: 101 }] },
});
await errorCode(() => resolveGitHubReleaseAsset(target(), { runner: draft.runner }), "release-draft", "draft release");

const missing = authorizedRunner({
  release: { id: 55, tag_name: "sctool/example-tool/v1.2.3", draft: false, assets: [] },
});
await errorCode(() => resolveGitHubReleaseAsset(target(), { runner: missing.runner }), "asset-not-found", "missing exact asset");

const binaryRequests = [];
const binaryRunner = async (request) => {
  binaryRequests.push(request);
  return { kind: "completed", exitCode: 0, stdout: new Uint8Array([0, 1, 2, 255]), stderr: "" };
};
const accessForDownload = authorizedRunner();
const retrieved = await retrieveGitHubReleaseAsset(target(), {
  runner: accessForDownload.runner,
  binaryRunner,
  environment: { PATH: "x", GITHUB_TOKEN: "forbidden" },
});
equal(retrieved.packageId, "example-tool", "retrieval preserves package id");
equal(retrieved.expectedTag, "sctool/example-tool/v1.2.3", "retrieval is release-bound");
equal(retrieved.assetId, 101, "retrieved exact asset id");
equal(retrieved.bytes.length, 4, "retrieved byte count without P4 integrity assertion");
equal(retrieved.bytes[3], 255, "binary bytes preserved");
equal(binaryRequests[0].args[1], "repos/Simple-Connection/sctool-artifacts/releases/assets/101", "download uses exact asset API path");
equal(binaryRequests[0].args[3], "Accept: application/octet-stream", "download requests binary asset");
truthy(!("GITHUB_TOKEN" in binaryRequests[0].env), "download strips GITHUB_TOKEN");
truthy(
  accessForDownload.requests.some((request) => request.args[1]?.includes("/releases/tags/")),
  "retrieval performs exact release resolution before download",
);

const missingForDownload = authorizedRunner({
  release: { id: 55, tag_name: "sctool/example-tool/v1.2.3", draft: false, assets: [] },
});
await errorCode(
  () => retrieveGitHubReleaseAsset(target(), { runner: missingForDownload.runner, binaryRunner }),
  "asset-not-found",
  "retrieval cannot bypass release binding",
);

let binaryOptions = null;
const execFileImpl = (_command, _args, options, callback) => {
  binaryOptions = options;
  callback(null, new Uint8Array([7, 8]), new Uint8Array());
};
const cliBinaryRunner = createGitHubCliBinaryCommandRunner({ execFileImpl, maxBufferBytes: 4096 });
truthy(cliBinaryRunner, "binary runner created");
const cliOutcome = await cliBinaryRunner({
  command: "gh",
  args: ["api", "repos/x/y/releases/assets/1"],
  env: { PATH: "x" },
  timeoutMs: 1000,
});
equal(cliOutcome.kind, "completed", "binary runner outcome");
equal(cliOutcome.stdout[1], 8, "binary runner preserves bytes");
equal(binaryOptions.encoding, null, "binary runner disables text encoding");
equal(binaryOptions.maxBuffer, 4096, "binary runner uses explicit caller buffer bound");
equal(createGitHubCliBinaryCommandRunner({ execFileImpl, maxBufferBytes: 0 }), null, "invalid binary buffer rejected");

console.log("Registry Client SDK artifact delivery PASS cases=24");
