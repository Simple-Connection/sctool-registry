import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  RegistryArtifactIntegrityError,
  stageAndVerifyRetrievedArtifact,
} from "../src/artifact-integrity.mjs";
import { createVerifiedArtifactLease } from "../src/verified-artifact.mjs";

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}
async function integrityError(fn, expected, label) {
  let actual = null;
  try { await fn(); } catch (error) {
    if (!(error instanceof RegistryArtifactIntegrityError)) throw error;
    actual = error.code;
  }
  equal(actual, expected, label);
}

const bytes = Buffer.from("verified-artifact-bytes");
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
    access: { contract: "registry-public-integrity-v1" },
    origin: { repository: "ExamplePublisher/example-tool", releaseId: 55, assetId: 101 },
    cache: { repository: "Simple-Connection/sctool-artifacts", releaseId: 77, assetId: 201 },
  },
  deliveryPlan: {
    currentDefaultVersion: "1.2.3",
    isCurrentDefaultVersion: true,
    preferredSource: "cache",
    fallbackSource: "origin",
  },
};

function retrieval(source = "cache", overrides = {}) {
  const locator = target.delivery[source];
  let aborted = false;
  const value = {
    packageId: target.packageId,
    version: target.version,
    targetKey: target.targetKey,
    source,
    repository: locator.repository,
    releaseId: locator.releaseId,
    assetId: locator.assetId,
    backendTag: source === "cache" ? "cache-observation" : "publisher-observation",
    backendAssetName: target.content.filename,
    backendAssetSize: target.content.size,
    stream: Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]),
    completed: Promise.resolve({ exitCode: 0 }),
    abort: () => { aborted = true; return true; },
    ...overrides,
  };
  return { value, wasAborted: () => aborted };
}

const root = await mkdtemp(join(tmpdir(), "sctool-registry-integrity-test-"));
try {
  const success = retrieval();
  const verified = await stageAndVerifyRetrievedArtifact(target, success.value, { temporaryRoot: root });
  equal(verified.source, "cache", "verified source");
  equal(verified.releaseId, 77, "verified exact cache release");
  equal(verified.assetId, 201, "verified exact cache asset");
  equal(verified.sha256, digest, "verified digest");
  const lease = createVerifiedArtifactLease(verified);
  await lease.dispose();
  equal((await readdir(root)).length, 0, "success cleanup");

  const origin = retrieval("origin");
  const originVerified = await stageAndVerifyRetrievedArtifact(target, origin.value, { temporaryRoot: root });
  equal(originVerified.source, "origin", "origin source verified");
  await originVerified.resource.dispose();

  const wrongRelease = retrieval("cache", { releaseId: 999 });
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, wrongRelease.value, { temporaryRoot: root }),
    "artifact-binding-mismatch",
    "release identity mismatch",
  );

  const wrongSource = retrieval("cache", { source: "origin" });
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, wrongSource.value, { temporaryRoot: root }),
    "artifact-binding-mismatch",
    "source locator mismatch",
  );

  const filenameMismatch = retrieval("cache", { backendAssetName: "other.sctool" });
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, filenameMismatch.value, { temporaryRoot: root }),
    "backend-filename-mismatch",
    "filename mismatch",
  );
  equal(filenameMismatch.wasAborted(), true, "filename mismatch aborts");

  const backendSizeMismatch = retrieval("cache", { backendAssetSize: bytes.length + 1 });
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, backendSizeMismatch.value, { temporaryRoot: root }),
    "backend-size-mismatch",
    "backend size mismatch",
  );

  const short = bytes.subarray(0, bytes.length - 1);
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, retrieval("cache", { backendAssetSize: null, stream: Readable.from([short]) }).value, { temporaryRoot: root }),
    "artifact-size-mismatch",
    "short stream rejected",
  );

  const corrupt = Buffer.from(bytes);
  corrupt[0] ^= 0xff;
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, retrieval("cache", { stream: Readable.from([corrupt]) }).value, { temporaryRoot: root }),
    "artifact-sha256-mismatch",
    "digest mismatch rejected",
  );

  equal((await readdir(root)).length, 0, "failure paths clean staging");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Registry Client SDK artifact integrity v3 PASS cases=12");
