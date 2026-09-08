import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";

import {
  RegistryArtifactDeliveryError,
  createGitHubCliStreamCommandRunner,
  deriveExpectedReleaseTag,
  openGitHubReleaseAssetStream,
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

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
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
equal(resolved.backendAssetName, "backend-observation.sctool", "backend name observation");
equal(resolved.backendAssetSize, 999, "backend size observation");
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

const streamRequests = [];
const streamRunner = async (request) => {
  streamRequests.push(request);
  return {
    kind: "started",
    stdout: Readable.from([Buffer.from([0, 1]), Buffer.from([2, 255])]),
    completion: Promise.resolve({ kind: "completed", exitCode: 0, stderr: "" }),
    abort: () => true,
  };
};
const accessForStream = authorizedRunner();
const opened = await openGitHubReleaseAssetStream(target(), {
  runner: accessForStream.runner,
  streamRunner,
  environment: { PATH: "x", GITHUB_TOKEN: "forbidden" },
});
equal(opened.packageId, "example-tool", "stream preserves package id");
equal(opened.releaseId, 55, "stream preserves release observation");
equal(opened.backendAssetName, "backend-observation.sctool", "stream preserves backend name");
equal(opened.backendAssetSize, 999, "stream preserves backend size");
const bytes = await readAll(opened.stream);
await opened.completed;
equal(bytes.length, 4, "streamed byte count");
equal(bytes[3], 255, "stream preserves binary bytes");
equal(streamRequests[0].args[1], "repos/Simple-Connection/sctool-artifacts/releases/assets/101", "stream uses exact asset API path");
equal(streamRequests[0].args[3], "Accept: application/octet-stream", "stream requests binary asset");
truthy(!("GITHUB_TOKEN" in streamRequests[0].env), "stream strips GITHUB_TOKEN");
truthy(accessForStream.requests.some((request) => request.args[1]?.includes("/releases/tags/")), "stream retrieval remains release-bound");

const failedStreamRunner = async () => ({
  kind: "started",
  stdout: Readable.from([]),
  completion: Promise.resolve({ kind: "completed", exitCode: 1, stderr: "failed" }),
  abort: () => true,
});
const failedAccess = authorizedRunner();
const failedOpened = await openGitHubReleaseAssetStream(target(), {
  runner: failedAccess.runner,
  streamRunner: failedStreamRunner,
});
await errorCode(() => failedOpened.completed, "download-failed", "nonzero stream completion fails closed");

let spawnOptions = null;
const spawnImpl = (_command, _args, options) => {
  spawnOptions = options;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    child.stdout.end(Buffer.from([7, 8]));
    child.stderr.end();
    child.emit("close", 0);
  });
  return child;
};
const cliStreamRunner = createGitHubCliStreamCommandRunner({ spawnImpl });
truthy(cliStreamRunner, "stream runner created");
const cliStarted = await cliStreamRunner({
  command: "gh",
  args: ["api", "repos/x/y/releases/assets/1"],
  env: { PATH: "x" },
  timeoutMs: 1000,
});
equal(cliStarted.kind, "started", "stream runner starts process");
const cliBytes = await readAll(cliStarted.stdout);
const cliCompletion = await cliStarted.completion;
equal(cliCompletion.kind, "completed", "stream runner completion");
equal(cliCompletion.exitCode, 0, "stream runner exit code");
equal(cliBytes[1], 8, "stream runner preserves bytes");
equal(spawnOptions.stdio[1], "pipe", "stream runner pipes stdout");
equal(createGitHubCliStreamCommandRunner({ spawnImpl, maxDiagnosticBytes: 0 }), null, "invalid diagnostic bound rejected");

console.log("Registry Client SDK artifact delivery PASS cases=29");
