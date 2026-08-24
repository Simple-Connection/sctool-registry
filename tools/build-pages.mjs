import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  privateKeyFromPkcs8Base64,
  publicKeyFromRawBase64,
  rawPublicKeyFromPrivate,
  sha256Bytes,
  signCanonical,
  signedEnvelopePayload,
  verifyCanonical,
} from "./lib/signing.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function requiredArg(name) {
  const value = readArg(name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}
function assertRevision(value) {
  if (!/^[0-9a-f]{40,64}$/.test(value)) throw new Error(`Invalid source revision: ${value}`);
}
function assertIsoDate(value, label) {
  const parsed = Date.parse(value);
  if (!value || Number.isNaN(parsed)) throw new Error(`Invalid ${label}: ${value}`);
}
function assertSafeRelativePath(path, expectedPrefix) {
  if (!path.startsWith(expectedPrefix) || path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Unsafe registry path: ${path}`);
  }
}
function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

const revision = requiredArg("--source-revision");
const sequence = Number(requiredArg("--sequence"));
const issuedAt = requiredArg("--issued-at");
const outDir = resolve(requiredArg("--out"));
assertRevision(revision);
if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Sequence must be a positive safe integer.");
assertIsoDate(issuedAt, "issued-at");

const rootPublicRaw = process.env.SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64?.trim();
const distributionPrivateB64 = process.env.SCTOOL_REGISTRY_DISTRIBUTION_PRIVATE_KEY_B64?.trim();
if (!rootPublicRaw) throw new Error("Missing SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64.");
if (!distributionPrivateB64) throw new Error("Missing SCTOOL_REGISTRY_DISTRIBUTION_PRIVATE_KEY_B64.");

const trustText = await readFile("trust/trust.json", "utf8");
const trust = parseJson(trustText, "trust/trust.json");
if (trust.schemaVersion !== "1.0.0" || trust.signed?.scope !== "sctool-registry-trust-v1") throw new Error("Unsupported trust descriptor.");
if (trust.proof?.keyId !== trust.signed.rootKeyId || trust.proof?.scope !== trust.signed.scope || trust.proof?.algorithm !== "ed25519") {
  throw new Error("Trust proof metadata is inconsistent.");
}
const rootPublic = publicKeyFromRawBase64(rootPublicRaw);
if (!verifyCanonical(rootPublic, signedEnvelopePayload(trust), trust.proof.signature)) {
  throw new Error("Root signature verification failed for trust/trust.json.");
}

const distributionPrivate = privateKeyFromPkcs8Base64(distributionPrivateB64);
const derivedDistributionPublic = rawPublicKeyFromPrivate(distributionPrivate);
const activeKeys = trust.signed.distributionKeys.filter((key) => key.status === "active" && key.publicKey === derivedDistributionPublic);
if (activeKeys.length !== 1) {
  throw new Error(`Distribution private key must match exactly one active trust key; matches=${activeKeys.length}`);
}
const signingKey = activeKeys[0];
const issuedMillis = Date.parse(issuedAt);
if (issuedMillis < Date.parse(signingKey.validFrom)) throw new Error(`Signing key ${signingKey.keyId} is not valid yet.`);
if (signingKey.validUntil && issuedMillis > Date.parse(signingKey.validUntil)) throw new Error(`Signing key ${signingKey.keyId} is expired.`);

const registryText = await readFile("registry.json", "utf8");
const registryBytes = Buffer.from(registryText, "utf8");
const registry = parseJson(registryText, "registry.json");
if (registry.schemaVersion !== "1.0.0" || typeof registry.packages !== "object" || typeof registry.publishers !== "object") {
  throw new Error("Unsupported registry.json.");
}

const packages = {};
for (const id of Object.keys(registry.packages).sort()) {
  const path = registry.packages[id];
  assertSafeRelativePath(path, "packages/");
  const descriptor = parseJson(await readFile(path, "utf8"), path);
  if (descriptor.id !== id) throw new Error(`Package index identity mismatch: ${id} -> ${descriptor.id}`);
  if (!descriptor.defaultChannel || !descriptor.channels || !descriptor.versions) throw new Error(`Package ${id} is missing defaultChannel/channels/versions.`);
  if (!(descriptor.defaultChannel in descriptor.channels)) throw new Error(`Package ${id} defaultChannel does not exist in channels.`);
  for (const [channel, version] of Object.entries(descriptor.channels)) {
    if (!(version in descriptor.versions)) throw new Error(`Package ${id} channel ${channel} points to missing version ${version}.`);
  }
  packages[id] = descriptor;
}

const publishers = {};
for (const id of Object.keys(registry.publishers).sort()) {
  const path = registry.publishers[id];
  assertSafeRelativePath(path, "publishers/");
  const descriptor = parseJson(await readFile(path, "utf8"), path);
  if (descriptor.id !== id) throw new Error(`Publisher index identity mismatch: ${id} -> ${descriptor.id}`);
  publishers[id] = descriptor;
}
for (const [id, descriptor] of Object.entries(packages)) {
  if (!(descriptor.publisher in publishers)) throw new Error(`Package ${id} references unregistered publisher ${descriptor.publisher}.`);
}

const snapshot = {
  schemaVersion: "1.0.0",
  sequence,
  revision,
  generatedAt: issuedAt,
  source: { repository: "Simple-Connection/sctool-registry", commit: revision },
  registrySha256: sha256Bytes(registryBytes),
  packages,
  publishers,
};
const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
const snapshotBytes = Buffer.from(snapshotText, "utf8");
const snapshotPath = `snapshots/${revision}.json`;

const head = {
  schemaVersion: "1.0.0",
  signed: {
    scope: "sctool-registry-head-v1",
    sequence,
    revision,
    issuedAt,
    trustSequence: trust.signed.sequence,
    signingKeyId: signingKey.keyId,
    snapshot: {
      path: snapshotPath,
      sha256: sha256Bytes(snapshotBytes),
      size: snapshotBytes.length,
    },
  },
  proof: {
    algorithm: "ed25519",
    scope: "sctool-registry-head-v1",
    keyId: signingKey.keyId,
    signature: "",
  },
};
head.proof.signature = signCanonical(distributionPrivate, signedEnvelopePayload(head));

await mkdir(resolve(outDir, dirname(snapshotPath)), { recursive: true });
await writeFile(resolve(outDir, snapshotPath), snapshotText, "utf8");
await writeFile(resolve(outDir, "registry-head.json"), `${JSON.stringify(head, null, 2)}\n`, "utf8");
await writeFile(resolve(outDir, "trust.json"), trustText.endsWith("\n") ? trustText : `${trustText}\n`, "utf8");
console.log(`Built signed Pages distribution revision=${revision} sequence=${sequence} packages=${Object.keys(packages).length}.`);
