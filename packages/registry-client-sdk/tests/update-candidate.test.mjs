import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  RegistryUpdateCandidateError,
  compareSemanticVersionPrecedence,
  evaluateUpdateCandidateEligibility,
  resolveUpdateCandidate,
} from "@simple-connection/sctool-registry-client-sdk/update-candidate";

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
    if (!(error instanceof RegistryUpdateCandidateError)) throw error;
    actual = error.code;
  }
  equal(actual, expected, label);
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const bytes = Buffer.from("candidate-bytes");
const digest = createHash("sha256").update(bytes).digest("hex");
const target = {
  packageId: "example-tool",
  channel: "stable",
  version: "1.2.3",
  targetKey: "win-x64",
  target: { platform: "win", arch: "x64" },
  content: { filename: "example-tool.sctool", sha256: digest, size: bytes.length },
  delivery: {
    type: "github-release-asset",
    access: { contract: "registry-access-v1" },
    locator: { repository: "Simple-Connection/sctool-artifacts", assetId: 101 },
  },
  publishedAt: "2026-09-06T00:00:00Z",
  contract: { sctoolSpecVersion: "1.0.0" },
};

function observation(installedVersion, overrides = {}) {
  return {
    authority: "AUTH_SIMPLE_CONNECTION_DESKTOP",
    packageId: "example-tool",
    targetKey: "win-x64",
    installedVersion,
    ...overrides,
  };
}

let textRequestCount = 0;
function authorizedRunner() {
  return async ({ args }) => {
    textRequestCount += 1;
    if (args[0] === "--version") return { kind: "completed", exitCode: 0, stdout: "gh version 2", stderr: "" };
    if (args[0] === "auth") return { kind: "completed", exitCode: 0, stdout: "", stderr: "" };
    if (args[1] === "user") return { kind: "completed", exitCode: 0, stdout: "tester", stderr: "" };
    if (args[1] === "repos/Simple-Connection/sctool-artifacts" && args[2] === "--silent") {
      return { kind: "completed", exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[1]?.includes("/releases/tags/")) {
      return {
        kind: "completed",
        exitCode: 0,
        stdout: JSON.stringify({
          id: 55,
          tag_name: "sctool/example-tool/v1.2.3",
          draft: false,
          assets: [{ id: 101, name: target.content.filename, size: target.content.size }],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command ${JSON.stringify(args)}`);
  };
}

let streamRequestCount = 0;
const streamRunner = async (request) => {
  streamRequestCount += 1;
  return {
    kind: "started",
    stdout: Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]),
    completion: Promise.resolve({ kind: "completed", exitCode: 0, stderr: "" }),
    abort: () => true,
  };
};

equal(compareSemanticVersionPrecedence("1.2.2", "1.2.3"), -1, "patch newer");
equal(compareSemanticVersionPrecedence("1.2.3", "1.2.3"), 0, "exact equal");
equal(compareSemanticVersionPrecedence("1.2.3+local", "1.2.3+registry"), 0, "build metadata ignored");
equal(compareSemanticVersionPrecedence("1.2.3-rc.1", "1.2.3"), -1, "release exceeds prerelease");
equal(compareSemanticVersionPrecedence("1.2.3-beta.2", "1.2.3-beta.11"), -1, "numeric prerelease ordering");
equal(compareSemanticVersionPrecedence("1.2.3-1", "1.2.3-alpha"), -1, "numeric prerelease below text");
equal(compareSemanticVersionPrecedence("1.2.3-alpha", "1.2.3-alpha.1"), -1, "short prerelease ordering");
equal(compareSemanticVersionPrecedence("1.2.3-01", "1.2.3-1"), 0, "schema-compatible numeric prerelease value");

const newerEligibility = evaluateUpdateCandidateEligibility(target, observation("1.2.2"));
equal(newerEligibility.state, "UPDATE_AVAILABLE", "newer state");
equal(newerEligibility.relation, "RESOLVED_NEWER", "newer relation");

const currentEligibility = evaluateUpdateCandidateEligibility(target, observation("1.2.3+local"));
equal(currentEligibility.state, "CURRENT", "current state");
equal(currentEligibility.relation, "EQUAL_PRECEDENCE", "current relation");

const downgradeEligibility = evaluateUpdateCandidateEligibility(target, observation("2.0.0"));
equal(downgradeEligibility.state, "DOWNGRADE_NOT_CANDIDATE", "downgrade state");
equal(downgradeEligibility.relation, "RESOLVED_OLDER", "downgrade relation");

textRequestCount = 0;
streamRequestCount = 0;
const current = await resolveUpdateCandidate(target, observation("1.2.3"));
equal(current.state, "CURRENT", "current resolution state");
equal(current.candidate, null, "current candidate null");
equal(textRequestCount, 0, "current performs no text retrieval");
equal(streamRequestCount, 0, "current performs no artifact retrieval");

const downgrade = await resolveUpdateCandidate(target, observation("2.0.0"));
equal(downgrade.state, "DOWNGRADE_NOT_CANDIDATE", "downgrade resolution state");
equal(downgrade.candidate, null, "downgrade candidate null");
equal(textRequestCount, 0, "downgrade performs no text retrieval");
equal(streamRequestCount, 0, "downgrade performs no artifact retrieval");

await errorCode(
  () => resolveUpdateCandidate(target, observation("1.2.2", { authority: "AUTH_REGISTRY_CLIENT_SDK" })),
  "installation-authority-mismatch",
  "wrong authority rejected",
);
equal(textRequestCount, 0, "wrong authority performs no retrieval");
equal(streamRequestCount, 0, "wrong authority performs no artifact retrieval");

await errorCode(
  () => resolveUpdateCandidate(target, observation("1.2.2", { packageId: "other-tool" })),
  "installation-binding-mismatch",
  "package binding rejected",
);
await errorCode(
  () => resolveUpdateCandidate(target, observation("1.2.2", { targetKey: "linux-x64" })),
  "installation-binding-mismatch",
  "target binding rejected",
);
await errorCode(
  () => resolveUpdateCandidate(target, { ...observation("1.2.2"), installPath: "forbidden" }),
  "invalid-installation-observation",
  "additional installation state rejected",
);
await errorCode(
  () => resolveUpdateCandidate(target, observation("not-semver")),
  "invalid-semver",
  "invalid installed version rejected",
);
equal(textRequestCount, 0, "invalid observations perform no retrieval");
equal(streamRequestCount, 0, "invalid observations perform no artifact retrieval");

const candidateResolution = await resolveUpdateCandidate(target, observation("1.2.2"), {
  runner: authorizedRunner(),
  streamRunner,
  environment: { PATH: "x", GH_TOKEN: "forbidden" },
});
equal(candidateResolution.state, "UPDATE_AVAILABLE", "candidate resolution state");
equal(candidateResolution.relation, "RESOLVED_NEWER", "candidate resolution relation");
truthy(candidateResolution.candidate, "verified candidate exists");
const candidate = candidateResolution.candidate;
equal(candidate.packageId, "example-tool", "package id");
equal(candidate.channel, "stable", "channel provenance");
equal(candidate.version, "1.2.3", "version");
equal(candidate.targetKey, "win-x64", "target key");
equal(candidate.target.platform, "win", "target platform");
equal(candidate.content.sha256, digest, "content digest");
equal(candidate.delivery.repository, "Simple-Connection/sctool-artifacts", "delivery repository");
equal(candidate.delivery.assetId, 101, "delivery asset id");
equal(candidate.delivery.expectedTag, "sctool/example-tool/v1.2.3", "delivery expected tag");
equal(candidate.contract.sctoolSpecVersion, "1.0.0", "contract version");
truthy(Object.isFrozen(candidate), "candidate frozen");
truthy(Object.isFrozen(candidate.content), "content frozen");
equal("installedVersion" in candidate, false, "installed version remains input only");
equal("isUpdateAvailable" in candidate, false, "candidate has no availability boolean");
equal("shouldInstall" in candidate, false, "candidate has no install decision");
equal("installPath" in candidate, false, "candidate has no install path");
equal("persistentInstallState" in candidate, false, "candidate has no persistent state");
equal("githubIdentity" in candidate, false, "GitHub identity excluded");
equal("path" in candidate.artifact, false, "raw path excluded");
equal("writeStream" in candidate.artifact, false, "write access excluded");
const output = await readAll(candidate.artifact.openReadStream());
equal(output.toString(), bytes.toString(), "candidate artifact bytes");
await candidate.artifact.dispose();
truthy(textRequestCount > 0, "newer candidate performs authenticated metadata requests");
equal(streamRequestCount, 1, "newer candidate retrieves exactly one artifact stream");

console.log("Registry Client SDK update candidate PASS cases=49");
