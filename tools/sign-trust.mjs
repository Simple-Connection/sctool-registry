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

const inputArg = readArg("--input");
const privatePathArg = readArg("--root-private-key");
const outputPath = resolve(readArg("--out") || "trust/trust.json");
const privateFromSecret = process.env.SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64?.trim();
const expectedRootPublic = process.env.SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64?.trim();

if (!inputArg) {
  throw new Error("Usage: node tools/sign-trust.mjs --input <unsigned.json> [--root-private-key <private.pk8.b64>] [--out trust/trust.json]");
}
if (privatePathArg && privateFromSecret) {
  throw new Error("Provide the Registry Root private key through exactly one source: --root-private-key or SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64.");
}
if (!privatePathArg && !privateFromSecret) {
  throw new Error("Missing Registry Root private key. Set SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64 or use --root-private-key for local recovery tooling.");
}

const inputPath = resolve(inputArg);
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

let privateMaterial = privateFromSecret;
if (!privateMaterial && privatePathArg) {
  privateMaterial = (await readFile(resolve(privatePathArg), "utf8")).trim();
}
const rootPrivate = privateKeyFromPkcs8Base64(privateMaterial);
const rootPublic = rawPublicKeyFromPrivate(rootPrivate);
if (expectedRootPublic && expectedRootPublic !== rootPublic) {
  throw new Error("Registry Root private key does not match SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64.");
}

try {
  const current = JSON.parse(await readFile(outputPath, "utf8"));
  const currentSequence = current?.signed?.sequence;
  if (Number.isSafeInteger(currentSequence)) {
    const sameSignedPayload = JSON.stringify(current.signed) === JSON.stringify(unsigned.signed);
    if (unsigned.signed.sequence < currentSequence) {
      throw new Error(`Trust sequence rollback rejected: incoming=${unsigned.signed.sequence}, current=${currentSequence}.`);
    }
    if (unsigned.signed.sequence === currentSequence && !sameSignedPayload) {
      throw new Error(`Conflicting trust payload rejected at sequence ${currentSequence}.`);
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

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
console.log(`Registry Root public key (base64-raw-32): ${rootPublic}`);
