import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { RegistryArtifactDeliveryError } from "../src/artifact-delivery.mjs";
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
    access: { contract: "registry-access-v1" },
    locator: { repository: "Simple-Connection/sctool-artifacts", assetId: 101 },
  },
  publishedAt: "2026-09-06T00:00:00Z",
  contract: { sctoolSpecVersion: "1.0.0" },
};

function retrieval(overrides = {}) {
  let aborted = false;
  const value = {
    packageId: target.packageId,
    version: target.version,
    targetKey: target.targetKey,
    repository: target.delivery.locator.repository,
    expectedTag: "sctool/example-tool/v1.2.3",
    releaseId: 55,
    assetId: 101,
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
  equal(verified.size, bytes.length, "verified size");
  equal(verified.sha256, digest, "verified digest");
  equal(verified.resource.state, "VERIFIED", "verified staging state");
  const lease = createVerifiedArtifactLease(verified);
  await lease.dispose();
  equal((await readdir(root)).length, 0, "success disposal removes staging directory");

  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, retrieval({ backendAssetName: "other.sctool" }).value, { temporaryRoot: root }),
    "backend-filename-mismatch",
    "filename mismatch",
  );
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, retrieval({ backendAssetSize: bytes.length + 1 }).value, { temporaryRoot: root }),
    "backend-size-mismatch",
    "backend size mismatch",
  );
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, retrieval({ version: "1.2.4" }).value, { temporaryRoot: root }),
    "artifact-binding-mismatch",
    "identity binding mismatch",
  );

  const oversized = retrieval({
    backendAssetSize: null,
    stream: Readable.from([Buffer.concat([bytes, Buffer.from([0])])]),
  });
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, oversized.value, { temporaryRoot: root }),
    "artifact-size-exceeded",
    "oversized stream aborts early",
  );
  equal(oversized.wasAborted(), true, "oversized stream abort requested");
  equal((await readdir(root)).length, 0, "oversized failure cleans staging");

  const shortBytes = bytes.subarray(0, bytes.length - 1);
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, retrieval({ backendAssetSize: null, stream: Readable.from([shortBytes]) }).value, { temporaryRoot: root }),
    "artifact-size-mismatch",
    "short stream rejected",
  );
  equal((await readdir(root)).length, 0, "short failure cleans staging");

  const corrupt = Buffer.from(bytes);
  corrupt[0] ^= 0xff;
  await integrityError(
    () => stageAndVerifyRetrievedArtifact(target, retrieval({ stream: Readable.from([corrupt]) }).value, { temporaryRoot: root }),
    "artifact-sha256-mismatch",
    "digest mismatch rejected",
  );
  equal((await readdir(root)).length, 0, "digest failure cleans staging");

  const transport = retrieval({
    completed: { then(_resolve, reject) { reject(new RegistryArtifactDeliveryError("download-failed", "failed")); } },
  });
  let transportCode = null;
  try {
    await stageAndVerifyRetrievedArtifact(target, transport.value, { temporaryRoot: root });
  } catch (error) {
    if (!(error instanceof RegistryArtifactDeliveryError)) throw error;
    transportCode = error.code;
  }
  equal(transportCode, "download-failed", "transport failure preserved");
  equal((await readdir(root)).length, 0, "transport failure cleans staging");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Registry Client SDK artifact integrity PASS cases=15");
