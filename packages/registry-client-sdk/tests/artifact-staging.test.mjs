import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  RegistryArtifactStagingError,
  allocateArtifactStagingResource,
} from "../src/artifact-staging.mjs";

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}

async function errorCode(fn, expected, label) {
  let actual = null;
  try { await fn(); } catch (error) {
    if (!(error instanceof RegistryArtifactStagingError)) throw error;
    actual = error.code;
  }
  equal(actual, expected, label);
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const resource = await allocateArtifactStagingResource();
equal(resource.state, "ALLOCATED", "allocated state");
const writer = resource.openWriteStream();
equal(resource.state, "WRITING", "writing state");
await pipeline(Readable.from([Buffer.from([1, 2, 3])]), writer);
resource.markStaged();
equal(resource.state, "STAGED", "staged state");
await resource.markVerified();
equal(resource.state, "VERIFIED", "verified state");
resource.markReleased();
equal(resource.state, "RELEASED", "released state");
const reader = resource.openReleasedReadStream();
await errorCode(() => resource.dispose(), "artifact-busy", "active reader blocks dispose");
const bytes = await readAll(reader);
equal(bytes.length, 3, "read length");
equal(bytes[2], 3, "read bytes");
await resource.dispose();
equal(resource.state, "DISPOSED", "disposed state");
await resource.dispose();
equal(resource.state, "DISPOSED", "dispose idempotent");
await errorCode(() => Promise.resolve(resource.openReleasedReadStream()), "artifact-disposed", "disposed read forbidden");

console.log("Registry Client SDK artifact staging PASS cases=11");
