import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  RegistryUpdateCandidateError,
  retrieveVerifiedUpdateCandidate,
} from "@simple-connection/sctool-registry-client-sdk/update-candidate";

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
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

function authorizedRunner() {
  return async ({ args }) => {
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

const streamRequests = [];
const streamRunner = async (request) => {
  streamRequests.push(request);
  return {
    kind: "started",
    stdout: Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]),
    completion: Promise.resolve({ kind: "completed", exitCode: 0, stderr: "" }),
    abort: () => true,
  };
};

const candidate = await retrieveVerifiedUpdateCandidate(target, {
  runner: authorizedRunner(),
  streamRunner,
  environment: { PATH: "x", GH_TOKEN: "forbidden" },
});
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
equal("githubIdentity" in candidate, false, "GitHub identity excluded");
equal("installedVersion" in candidate, false, "install state excluded");
equal("isUpdateAvailable" in candidate, false, "update decision excluded");
equal("path" in candidate.artifact, false, "raw path excluded");
equal("writeStream" in candidate.artifact, false, "write access excluded");
const output = await readAll(candidate.artifact.openReadStream());
equal(output.toString(), bytes.toString(), "candidate artifact bytes");
await candidate.artifact.dispose();
equal(streamRequests[0].args[1], "repos/Simple-Connection/sctool-artifacts/releases/assets/101", "candidate uses exact asset endpoint");

let invalidCode = null;
try {
  await retrieveVerifiedUpdateCandidate({ ...target, publishedAt: null }, {
    runner: authorizedRunner(),
    streamRunner,
  });
} catch (error) {
  if (!(error instanceof RegistryUpdateCandidateError)) throw error;
  invalidCode = error.code;
}
equal(invalidCode, "invalid-target", "invalid candidate source rejected before retrieval");

console.log("Registry Client SDK update candidate PASS cases=20");
