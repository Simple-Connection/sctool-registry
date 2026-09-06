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
      access: { contract: "registry-access-v1" },
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

export function createRetrievalHarness(target = makeTarget()) {
  const counters = {
    textRequests: 0,
    releaseQueries: 0,
    assetStreams: 0,
  };

  const runner = async ({ args }) => {
    counters.textRequests += 1;
    if (args[0] === "--version") {
      return { kind: "completed", exitCode: 0, stdout: "gh version 2", stderr: "" };
    }
    if (args[0] === "auth") {
      return { kind: "completed", exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[1] === "user") {
      return { kind: "completed", exitCode: 0, stdout: "tester", stderr: "" };
    }
    if (
      args[1] === "repos/Simple-Connection/sctool-artifacts"
      && args[2] === "--silent"
    ) {
      return { kind: "completed", exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[1]?.includes("/releases/tags/")) {
      counters.releaseQueries += 1;
      return {
        kind: "completed",
        exitCode: 0,
        stdout: JSON.stringify({
          id: 55,
          tag_name: `sctool/${target.packageId}/v${target.version}`,
          draft: false,
          assets: [{
            id: target.delivery.locator.assetId,
            name: target.content.filename,
            size: target.content.size,
          }],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command ${JSON.stringify(args)}`);
  };

  const streamRunner = async () => {
    counters.assetStreams += 1;
    return {
      kind: "started",
      stdout: Readable.from([
        artifactBytes.subarray(0, 4),
        artifactBytes.subarray(4),
      ]),
      completion: Promise.resolve({
        kind: "completed",
        exitCode: 0,
        stderr: "",
      }),
      abort: () => true,
    };
  };

  return { counters, runner, streamRunner };
}
