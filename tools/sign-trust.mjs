import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  privateKeyFromPkcs8Base64,
  rawPublicKeyFromPrivate,
  signCanonical,
  signedEnvelopePayload,
} from "./lib/signing.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputPath = resolve(readArg("--input") || "");
const privatePath = resolve(readArg("--root-private-key") || "");
const outputPath = resolve(readArg("--out") || "trust/trust.json");
if (!readArg("--input") || !readArg("--root-private-key")) {
  throw new Error("Usage: node tools/sign-trust.mjs --input <unsigned.json> --root-private-key <private.pk8.b64> [--out trust/trust.json]");
}

const unsigned = JSON.parse(await readFile(inputPath, "utf8"));
if (unsigned.schemaVersion !== "1.0.0" || !unsigned.signed || unsigned.proof) {
  throw new Error("Unsigned trust input must contain schemaVersion=1.0.0 and signed, and must not contain proof.");
}
if (unsigned.signed.scope !== "sctool-registry-trust-v1") throw new Error("Invalid trust signature scope.");
if (!Number.isSafeInteger(unsigned.signed.sequence) || unsigned.signed.sequence < 1) throw new Error("Trust sequence must be a positive integer.");
if (!Array.isArray(unsigned.signed.distributionKeys) || unsigned.signed.distributionKeys.length < 1) {
  throw new Error("At least one distribution key is required.");
}
const ids = new Set();
for (const key of unsigned.signed.distributionKeys) {
  if (ids.has(key.keyId)) throw new Error(`Duplicate distribution keyId: ${key.keyId}`);
  ids.add(key.keyId);
}

const rootPrivate = privateKeyFromPkcs8Base64(await readFile(privatePath, "utf8"));
const rootPublic = rawPublicKeyFromPrivate(rootPrivate);
const envelope = {
  schemaVersion: unsigned.schemaVersion,
  signed: unsigned.signed,
  proof: {
    algorithm: "ed25519",
    scope: "sctool-registry-trust-v1",
    keyId: unsigned.signed.rootKeyId,
    signature: "",
  },
};
envelope.proof.signature = signCanonical(rootPrivate, signedEnvelopePayload(envelope));
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
console.log(`Signed trust descriptor written to: ${outputPath}`);
console.log(`Root public key (base64-raw-32) must be pinned independently by Simple Connection: ${rootPublic}`);
