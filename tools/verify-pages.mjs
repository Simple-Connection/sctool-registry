import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  publicKeyFromRawBase64,
  sha256Bytes,
  signedEnvelopePayload,
  verifyCanonical,
} from "./lib/signing.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const site = resolve(readArg("--site") || "_site");
const rootPublicRaw = process.env.SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64?.trim();
if (!rootPublicRaw) throw new Error("Missing SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64.");

const trust = JSON.parse(await readFile(resolve(site, "trust.json"), "utf8"));
const head = JSON.parse(await readFile(resolve(site, "registry-head.json"), "utf8"));
const rootPublic = publicKeyFromRawBase64(rootPublicRaw);
if (!verifyCanonical(rootPublic, signedEnvelopePayload(trust), trust.proof.signature)) throw new Error("Trust root signature verification failed.");
if (head.proof.keyId !== head.signed.signingKeyId || head.proof.scope !== head.signed.scope) throw new Error("Head proof metadata mismatch.");
if (head.signed.trustSequence !== trust.signed.sequence) throw new Error("Head trustSequence does not match trust descriptor.");
const key = trust.signed.distributionKeys.find((candidate) => candidate.keyId === head.signed.signingKeyId);
if (!key || key.status !== "active") throw new Error("Head signing key is not active in trust descriptor.");
if (!verifyCanonical(publicKeyFromRawBase64(key.publicKey), signedEnvelopePayload(head), head.proof.signature)) {
  throw new Error("Registry head signature verification failed.");
}

const snapshotBytes = await readFile(resolve(site, head.signed.snapshot.path));
if (snapshotBytes.length !== head.signed.snapshot.size) throw new Error("Snapshot size mismatch.");
if (sha256Bytes(snapshotBytes) !== head.signed.snapshot.sha256) throw new Error("Snapshot SHA-256 mismatch.");
const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
if (snapshot.sequence !== head.signed.sequence || snapshot.revision !== head.signed.revision) throw new Error("Snapshot identity mismatch.");
if (snapshot.source?.commit !== head.signed.revision) throw new Error("Snapshot source commit mismatch.");
console.log(`Verified Pages distribution revision=${snapshot.revision} sequence=${snapshot.sequence}.`);
