import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  publicKeyFromRawBase64,
  signedEnvelopePayload,
  verifyCanonical,
} from "./lib/signing.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const trustPath = resolve(readArg("--trust") || "trust/trust.json");
const rootPublicRaw = process.env.SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64?.trim();
if (!rootPublicRaw) throw new Error("Missing SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64.");

const trust = JSON.parse(await readFile(trustPath, "utf8"));
if (trust.schemaVersion !== "1.0.0" || !trust.signed || !trust.proof) {
  throw new Error("Invalid trust envelope structure.");
}
if (trust.signed.scope !== "sctool-registry-trust-v1") throw new Error("Invalid trust signed scope.");
if (trust.proof.scope !== trust.signed.scope) throw new Error("Trust proof scope mismatch.");
if (trust.proof.algorithm !== "ed25519") throw new Error("Unsupported trust signature algorithm.");
if (trust.proof.keyId !== trust.signed.rootKeyId) throw new Error("Trust root keyId mismatch.");
if (!verifyCanonical(publicKeyFromRawBase64(rootPublicRaw), signedEnvelopePayload(trust), trust.proof.signature)) {
  throw new Error("Registry Root signature verification failed.");
}

console.log(`Verified root-signed trust descriptor sequence=${trust.signed.sequence} rootKeyId=${trust.signed.rootKeyId}.`);
