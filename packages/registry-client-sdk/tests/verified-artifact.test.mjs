import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { stageAndVerifyRetrievedArtifact } from "../src/artifact-integrity.mjs";
import {
  RegistryVerifiedArtifactError,
  createVerifiedArtifactLease,
  isVerifiedArtifactLease,
} from "../src/verified-artifact.mjs";

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}

async function verifiedError(fn, expected, label) {
  let actual = null;
  try { await fn(); } catch (error) {
    if (!(error instanceof RegistryVerifiedArtifactError)) throw error;
    actual = error.code;
  }
  equal(actual, expected, label);
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const bytes = Buffer.from("lease-bytes");
const digest = createHash("sha256").update(bytes).digest("hex");
const target = {
  packageId: "example-tool",
  version: "1.2.3",
  targetKey: "win-x64",
  content: { filename: "example.sctool", size: bytes.length, sha256: digest },
  delivery: { locator: { repository: "Simple-Connection/sctool-artifacts", assetId: 101 } },
};
const retrieval = {
  packageId: "example-tool",
  version: "1.2.3",
  targetKey: "win-x64",
  repository: "Simple-Connection/sctool-artifacts",
  expectedTag: "sctool/example-tool/v1.2.3",
  releaseId: 55,
  assetId: 101,
  backendAssetName: "example.sctool",
  backendAssetSize: bytes.length,
  stream: Readable.from([bytes]),
  completed: Promise.resolve({ exitCode: 0 }),
  abort: () => true,
};
const verified = await stageAndVerifyRetrievedArtifact(target, retrieval);
const lease = createVerifiedArtifactLease(verified);
equal(isVerifiedArtifactLease(lease), true, "lease brand");
equal("path" in lease, false, "raw path not exposed");
equal("writeStream" in lease, false, "write access not exposed");
const reader = lease.openReadStream();
await verifiedError(() => lease.dispose(), "artifact-busy", "active reader blocks dispose");
const output = await readAll(reader);
equal(output.toString(), bytes.toString(), "read stream preserves verified bytes");
await lease.dispose();
await lease.dispose();
await verifiedError(() => Promise.resolve(lease.openReadStream()), "artifact-disposed", "disposed lease blocks reads");

console.log("Registry Client SDK verified artifact access PASS cases=8");
