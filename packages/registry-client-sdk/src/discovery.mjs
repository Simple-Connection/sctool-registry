import {
  createHash,
  createPublicKey,
  verify as ed25519Verify,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const REVISION_RE = /^[0-9a-f]{40,64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MARKETPLACE_PROFILE_KEYS = new Set([
  "schemaVersion",
  "details",
  "features",
  "changelog",
  "dependencies",
  "extension_pack",
]);

export const REGISTRY_DISCOVERY_CONTRACT = "registry-discovery-v1";
export const REGISTRY_ANTI_ROLLBACK_STATE_SCHEMA = "sctool-registry-anti-rollback/v1";
export const REGISTRY_DISCOVERY_ERROR_CODES = Object.freeze({
  DISTRIBUTION_INACTIVE: "REGISTRY_DISTRIBUTION_INACTIVE",
  FETCH_FAILED: "REGISTRY_FETCH_FAILED",
  TRUST_INVALID: "REGISTRY_TRUST_INVALID",
  ROOT_KEY_UNTRUSTED: "REGISTRY_ROOT_KEY_UNTRUSTED",
  ROOT_SIGNATURE_INVALID: "REGISTRY_ROOT_SIGNATURE_INVALID",
  HEAD_INVALID: "REGISTRY_HEAD_INVALID",
  DISTRIBUTION_KEY_INVALID: "REGISTRY_DISTRIBUTION_KEY_INVALID",
  DISTRIBUTION_SIGNATURE_INVALID: "REGISTRY_DISTRIBUTION_SIGNATURE_INVALID",
  SNAPSHOT_FETCH_FAILED: "REGISTRY_SNAPSHOT_FETCH_FAILED",
  SNAPSHOT_SIZE_MISMATCH: "REGISTRY_SNAPSHOT_SIZE_MISMATCH",
  SNAPSHOT_DIGEST_MISMATCH: "REGISTRY_SNAPSHOT_DIGEST_MISMATCH",
  SNAPSHOT_INVALID: "REGISTRY_SNAPSHOT_INVALID",
  ANTI_ROLLBACK_STORE_REQUIRED: "REGISTRY_ANTI_ROLLBACK_STORE_REQUIRED",
  ANTI_ROLLBACK_STATE_CORRUPT: "REGISTRY_ANTI_ROLLBACK_STATE_CORRUPT",
  ROLLBACK_DETECTED: "REGISTRY_ROLLBACK_DETECTED",
  SEQUENCE_CONFLICT: "REGISTRY_SEQUENCE_CONFLICT",
});

export class RegistryDiscoveryError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "RegistryDiscoveryError";
    this.code = code;
  }
}

function fail(code, message, cause = undefined) {
  throw new RegistryDiscoveryError(code, message, cause ? { cause } : undefined);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const copy = {};
    for (const [key, child] of Object.entries(value)) copy[key] = cloneValue(child);
    return copy;
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertCanonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail(REGISTRY_DISCOVERY_ERROR_CODES.TRUST_INVALID, "canonical JSON permits safe integers only");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCanonicalValue(item);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) fail(REGISTRY_DISCOVERY_ERROR_CODES.TRUST_INVALID, `undefined canonical member ${key}`);
      assertCanonicalValue(child);
    }
    return;
  }
  fail(REGISTRY_DISCOVERY_ERROR_CODES.TRUST_INVALID, `unsupported canonical JSON type ${typeof value}`);
}

function canonicalJson(value) {
  assertCanonicalValue(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function signedEnvelopePayload(envelope) {
  return { schemaVersion: envelope.schemaVersion, signed: envelope.signed };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicKeyFromRawBase64(value, code) {
  let raw;
  try {
    raw = Buffer.from(String(value ?? "").trim(), "base64");
  } catch (error) {
    fail(code, "invalid base64 Ed25519 public key", error);
  }
  if (raw.length !== 32) fail(code, "Ed25519 public key must be exactly 32 raw bytes");
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function verifyEnvelopeSignature(publicKeyRaw, envelope, code) {
  const publicKey = publicKeyFromRawBase64(publicKeyRaw, code);
  let signature;
  try {
    signature = Buffer.from(String(envelope?.proof?.signature ?? ""), "base64");
  } catch (error) {
    fail(code, "invalid base64 Ed25519 signature", error);
  }
  if (signature.length !== 64) fail(code, "Ed25519 signature must be exactly 64 bytes");
  if (!ed25519Verify(null, canonicalBytes(signedEnvelopePayload(envelope)), publicKey, signature)) {
    fail(code, "Ed25519 signature verification failed");
  }
}

function timestamp(value, code, label) {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(parsed)) fail(code, `${label} must be an RFC 3339 date-time`);
  return parsed;
}

function positiveSafeInteger(value, code, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(code, `${label} must be a positive safe integer`);
  return value;
}

function trustedRootKey(trustedRootKeys, keyId) {
  if (trustedRootKeys instanceof Map) return trustedRootKeys.get(keyId);
  if (isPlainObject(trustedRootKeys)) return trustedRootKeys[keyId];
  return undefined;
}

export function verifyRegistryTrustEnvelope(trust, { trustedRootKeys, now = new Date() } = {}) {
  const code = REGISTRY_DISCOVERY_ERROR_CODES.TRUST_INVALID;
  if (!isPlainObject(trust) || trust.schemaVersion !== "1.0.0" || !isPlainObject(trust.signed) || !isPlainObject(trust.proof)) {
    fail(code, "unsupported Registry trust envelope");
  }
  const signed = trust.signed;
  const proof = trust.proof;
  if (signed.scope !== "sctool-registry-trust-v1" || proof.scope !== signed.scope || proof.algorithm !== "ed25519") {
    fail(code, "Registry trust scope or algorithm is invalid");
  }
  positiveSafeInteger(signed.sequence, code, "trust sequence");
  timestamp(signed.issuedAt, code, "trust issuedAt");
  if (typeof signed.rootKeyId !== "string" || proof.keyId !== signed.rootKeyId) fail(code, "Registry trust root key identity is inconsistent");
  if (!Array.isArray(signed.distributionKeys) || signed.distributionKeys.length === 0) fail(code, "Registry trust has no distribution keys");

  const rootKey = trustedRootKey(trustedRootKeys, signed.rootKeyId);
  if (typeof rootKey !== "string" || rootKey.length === 0) {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.ROOT_KEY_UNTRUSTED, `root key ${signed.rootKeyId} is not in the caller trust anchor set`);
  }
  verifyEnvelopeSignature(rootKey, trust, REGISTRY_DISCOVERY_ERROR_CODES.ROOT_SIGNATURE_INVALID);

  const nowMillis = now instanceof Date ? now.getTime() : timestamp(String(now), code, "now");
  const distributionKeys = {};
  for (const key of signed.distributionKeys) {
    if (!isPlainObject(key) || typeof key.keyId !== "string" || key.algorithm !== "ed25519" || key.encoding !== "base64-raw-32") {
      fail(code, "Registry distribution key metadata is invalid");
    }
    if (Object.prototype.hasOwnProperty.call(distributionKeys, key.keyId)) fail(code, `duplicate distribution key ${key.keyId}`);
    publicKeyFromRawBase64(key.publicKey, code);
    const validFrom = timestamp(key.validFrom, code, `distribution key ${key.keyId} validFrom`);
    const validUntil = key.validUntil === undefined ? null : timestamp(key.validUntil, code, `distribution key ${key.keyId} validUntil`);
    if (validUntil !== null && validUntil < validFrom) fail(code, `distribution key ${key.keyId} has an invalid validity range`);
    if (key.status === "revoked" && !key.revokedAt) fail(code, `revoked distribution key ${key.keyId} is missing revokedAt`);
    if (key.status === "retired" && !key.retiredAt) fail(code, `retired distribution key ${key.keyId} is missing retiredAt`);
    if (!["active", "retired", "revoked"].includes(key.status)) fail(code, `distribution key ${key.keyId} has an invalid status`);
    distributionKeys[key.keyId] = deepFreeze({ ...cloneValue(key), validNow: key.status === "active" && nowMillis >= validFrom && (validUntil === null || nowMillis <= validUntil) });
  }

  return deepFreeze({
    schemaVersion: trust.schemaVersion,
    sequence: signed.sequence,
    issuedAt: signed.issuedAt,
    rootKeyId: signed.rootKeyId,
    distributionKeys,
  });
}

export function verifyRegistryHeadEnvelope(head, verifiedTrust) {
  const code = REGISTRY_DISCOVERY_ERROR_CODES.HEAD_INVALID;
  if (!isPlainObject(head) || head.schemaVersion !== "1.0.0" || !isPlainObject(head.signed) || !isPlainObject(head.proof)) {
    fail(code, "unsupported Registry head envelope");
  }
  const signed = head.signed;
  const proof = head.proof;
  if (signed.scope !== "sctool-registry-head-v1" || proof.scope !== signed.scope || proof.algorithm !== "ed25519") {
    fail(code, "Registry head scope or algorithm is invalid");
  }
  positiveSafeInteger(signed.sequence, code, "head sequence");
  positiveSafeInteger(signed.trustSequence, code, "head trust sequence");
  if (!REVISION_RE.test(String(signed.revision ?? ""))) fail(code, "Registry head revision is invalid");
  const issuedAt = timestamp(signed.issuedAt, code, "head issuedAt");
  if (signed.trustSequence !== verifiedTrust?.sequence) fail(code, "Registry head trust sequence does not match verified trust");
  if (typeof signed.signingKeyId !== "string" || proof.keyId !== signed.signingKeyId) fail(code, "Registry head signing key identity is inconsistent");
  const key = verifiedTrust?.distributionKeys?.[signed.signingKeyId];
  if (!key || key.status !== "active") fail(REGISTRY_DISCOVERY_ERROR_CODES.DISTRIBUTION_KEY_INVALID, `distribution key ${signed.signingKeyId} is not active`);
  const validFrom = Date.parse(key.validFrom);
  const validUntil = key.validUntil ? Date.parse(key.validUntil) : null;
  if (issuedAt < validFrom || (validUntil !== null && issuedAt > validUntil)) {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.DISTRIBUTION_KEY_INVALID, `distribution key ${signed.signingKeyId} was not valid at head issuance`);
  }
  verifyEnvelopeSignature(key.publicKey, head, REGISTRY_DISCOVERY_ERROR_CODES.DISTRIBUTION_SIGNATURE_INVALID);

  if (!isPlainObject(signed.snapshot) || typeof signed.snapshot.path !== "string" || signed.snapshot.path !== `snapshots/${signed.revision}.json`) {
    fail(code, "Registry head snapshot path is not immutable for the signed revision");
  }
  if (!SHA256_RE.test(String(signed.snapshot.sha256 ?? ""))) fail(code, "Registry head snapshot digest is invalid");
  positiveSafeInteger(signed.snapshot.size, code, "snapshot size");

  return deepFreeze(cloneValue(head));
}

export function verifyRegistrySnapshotBytes(bytes, verifiedHead) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const expected = verifiedHead.signed.snapshot;
  if (buffer.length !== expected.size) {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.SNAPSHOT_SIZE_MISMATCH, `snapshot size ${buffer.length} does not match signed size ${expected.size}`);
  }
  const digest = sha256(buffer);
  if (digest !== expected.sha256) {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.SNAPSHOT_DIGEST_MISMATCH, `snapshot sha256 ${digest} does not match signed digest ${expected.sha256}`);
  }

  let snapshot;
  try {
    snapshot = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.SNAPSHOT_INVALID, "Registry snapshot is not valid JSON", error);
  }
  const code = REGISTRY_DISCOVERY_ERROR_CODES.SNAPSHOT_INVALID;
  if (!isPlainObject(snapshot) || snapshot.schemaVersion !== "1.0.0") fail(code, "unsupported Registry snapshot");
  if (snapshot.sequence !== verifiedHead.signed.sequence || snapshot.revision !== verifiedHead.signed.revision) {
    fail(code, "Registry snapshot sequence or revision does not match signed head");
  }
  if (!isPlainObject(snapshot.source) || snapshot.source.repository !== "Simple-Connection/sctool-registry" || snapshot.source.commit !== snapshot.revision) {
    fail(code, "Registry snapshot source identity is invalid");
  }
  if (!SHA256_RE.test(String(snapshot.registrySha256 ?? ""))) fail(code, "Registry snapshot registrySha256 is invalid");
  if (!isPlainObject(snapshot.packages) || !isPlainObject(snapshot.publishers)) fail(code, "Registry snapshot catalog maps are invalid");
  if (snapshot.marketplaceProfiles !== undefined && !isPlainObject(snapshot.marketplaceProfiles)) fail(code, "Registry snapshot marketplaceProfiles must be an object");
  return deepFreeze(cloneValue(snapshot));
}

function validateAntiRollbackState(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value) || value.schema !== REGISTRY_ANTI_ROLLBACK_STATE_SCHEMA || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !REVISION_RE.test(String(value.revision ?? ""))) {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.ANTI_ROLLBACK_STATE_CORRUPT, "anti-rollback state is corrupt or unsupported");
  }
  return { schema: value.schema, sequence: value.sequence, revision: value.revision };
}

export function createMemoryAntiRollbackStore(initialState = null) {
  let state = initialState === null ? null : validateAntiRollbackState(initialState);
  return Object.freeze({
    async load() {
      return state === null ? null : { ...state };
    },
    async save(next) {
      state = validateAntiRollbackState(next);
    },
  });
}

export function createFileAntiRollbackStore(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) throw new TypeError("filePath is required");
  return Object.freeze({
    async load() {
      let text;
      try {
        text = await readFile(filePath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        fail(REGISTRY_DISCOVERY_ERROR_CODES.ANTI_ROLLBACK_STATE_CORRUPT, "failed to read anti-rollback state", error);
      }
      try {
        return validateAntiRollbackState(JSON.parse(text));
      } catch (error) {
        if (error instanceof RegistryDiscoveryError) throw error;
        fail(REGISTRY_DISCOVERY_ERROR_CODES.ANTI_ROLLBACK_STATE_CORRUPT, "anti-rollback state is not valid JSON", error);
      }
    },
    async save(next) {
      const state = validateAntiRollbackState(next);
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag: "wx" });
        await rename(temporary, filePath);
      } catch (error) {
        fail(REGISTRY_DISCOVERY_ERROR_CODES.ANTI_ROLLBACK_STATE_CORRUPT, "failed to persist anti-rollback state atomically", error);
      }
    },
  });
}

export async function acceptRegistrySequence(antiRollbackStore, { sequence, revision }) {
  if (!antiRollbackStore || typeof antiRollbackStore.load !== "function" || typeof antiRollbackStore.save !== "function") {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.ANTI_ROLLBACK_STORE_REQUIRED, "verified discovery requires a persistent anti-rollback store");
  }
  const next = validateAntiRollbackState({ schema: REGISTRY_ANTI_ROLLBACK_STATE_SCHEMA, sequence, revision });
  const previous = validateAntiRollbackState(await antiRollbackStore.load());
  if (previous) {
    if (next.sequence < previous.sequence) {
      fail(REGISTRY_DISCOVERY_ERROR_CODES.ROLLBACK_DETECTED, `Registry sequence ${next.sequence} is older than accepted sequence ${previous.sequence}`);
    }
    if (next.sequence === previous.sequence && next.revision !== previous.revision) {
      fail(REGISTRY_DISCOVERY_ERROR_CODES.SEQUENCE_CONFLICT, `Registry sequence ${next.sequence} changed revision`);
    }
    if (next.sequence === previous.sequence) return deepFreeze(previous);
  }
  await antiRollbackStore.save(next);
  return deepFreeze(next);
}

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" && !(baseUrl instanceof URL)) throw new TypeError("baseUrl is required");
  const text = String(baseUrl);
  return new URL(text.endsWith("/") ? text : `${text}/`);
}

async function fetchResource(fetchImpl, url, { inactiveOnMissing = false } = {}) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.FETCH_FAILED, `failed to fetch ${url}`, error);
  }
  if (inactiveOnMissing && (response.status === 404 || response.status === 410)) return null;
  if (!response.ok) fail(REGISTRY_DISCOVERY_ERROR_CODES.FETCH_FAILED, `fetch ${url} failed with HTTP ${response.status}`);
  return response;
}

async function fetchJson(fetchImpl, url, options = undefined) {
  const response = await fetchResource(fetchImpl, url, options);
  if (response === null) return null;
  try {
    return await response.json();
  } catch (error) {
    fail(REGISTRY_DISCOVERY_ERROR_CODES.FETCH_FAILED, `${url} did not return valid JSON`, error);
  }
}

function failureResult(error) {
  const code = error instanceof RegistryDiscoveryError ? error.code : REGISTRY_DISCOVERY_ERROR_CODES.FETCH_FAILED;
  return deepFreeze({
    ok: false,
    state: code === REGISTRY_DISCOVERY_ERROR_CODES.DISTRIBUTION_INACTIVE ? "DISTRIBUTION_INACTIVE" : "FAIL_CLOSED",
    code,
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function discoverVerifiedRegistry({
  baseUrl,
  trustedRootKeys,
  antiRollbackStore,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  try {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    if (!antiRollbackStore) fail(REGISTRY_DISCOVERY_ERROR_CODES.ANTI_ROLLBACK_STORE_REQUIRED, "verified discovery requires an anti-rollback store");
    const base = normalizeBaseUrl(baseUrl);
    const trustUrl = new URL("trust.json", base);
    const headUrl = new URL("registry-head.json", base);
    const trust = await fetchJson(fetchImpl, trustUrl, { inactiveOnMissing: true });
    const head = await fetchJson(fetchImpl, headUrl, { inactiveOnMissing: true });
    if (trust === null || head === null) {
      fail(REGISTRY_DISCOVERY_ERROR_CODES.DISTRIBUTION_INACTIVE, "signed Registry Pages distribution is not active");
    }

    const verifiedTrust = verifyRegistryTrustEnvelope(trust, { trustedRootKeys, now });
    const verifiedHead = verifyRegistryHeadEnvelope(head, verifiedTrust);
    const snapshotUrl = new URL(verifiedHead.signed.snapshot.path, base);
    const snapshotResponse = await fetchResource(fetchImpl, snapshotUrl);
    let snapshotBytes;
    try {
      snapshotBytes = Buffer.from(await snapshotResponse.arrayBuffer());
    } catch (error) {
      fail(REGISTRY_DISCOVERY_ERROR_CODES.SNAPSHOT_FETCH_FAILED, "failed to read Registry snapshot bytes", error);
    }
    const snapshot = verifyRegistrySnapshotBytes(snapshotBytes, verifiedHead);
    const accepted = await acceptRegistrySequence(antiRollbackStore, {
      sequence: snapshot.sequence,
      revision: snapshot.revision,
    });

    return deepFreeze({
      ok: true,
      state: "VERIFIED",
      contract: REGISTRY_DISCOVERY_CONTRACT,
      verification: {
        trustSequence: verifiedTrust.sequence,
        sequence: snapshot.sequence,
        revision: snapshot.revision,
        signingKeyId: verifiedHead.signed.signingKeyId,
        snapshotSha256: verifiedHead.signed.snapshot.sha256,
        acceptedSequence: accepted.sequence,
      },
      snapshot,
    });
  } catch (error) {
    return failureResult(error);
  }
}

function requireVerifiedCatalog(catalog) {
  if (!isPlainObject(catalog) || catalog.ok !== true || catalog.state !== "VERIFIED" || catalog.contract !== REGISTRY_DISCOVERY_CONTRACT || !isPlainObject(catalog.snapshot)) {
    throw new TypeError("verified Registry discovery result is required");
  }
  return catalog.snapshot;
}

export function projectVerifiedMarketplaceProfile(catalog, packageId) {
  const snapshot = requireVerifiedCatalog(catalog);
  const profile = snapshot.marketplaceProfiles?.[packageId];
  if (!isPlainObject(profile)) return null;
  for (const key of Object.keys(profile)) if (!MARKETPLACE_PROFILE_KEYS.has(key)) return null;
  if (profile.schemaVersion !== 1) return null;
  if (typeof profile.details !== "string" || profile.details.trim().length === 0) return null;
  if (typeof profile.features !== "string" || profile.features.trim().length === 0) return null;
  for (const key of ["changelog", "dependencies", "extension_pack"]) {
    if (profile[key] !== undefined && typeof profile[key] !== "string") return null;
  }
  return deepFreeze(cloneValue(profile));
}

export function resolveVerifiedDefaultRelease(catalog, packageId) {
  const snapshot = requireVerifiedCatalog(catalog);
  const descriptor = snapshot.packages[packageId];
  if (!isPlainObject(descriptor)) return null;
  const channel = descriptor.defaultChannel;
  const version = descriptor.channels?.[channel];
  if (typeof channel !== "string" || typeof version !== "string" || !isPlainObject(descriptor.versions?.[version])) return null;
  return deepFreeze({ channel, version, release: cloneValue(descriptor.versions[version]) });
}

export function resolveVerifiedStableRelease(catalog, packageId) {
  const snapshot = requireVerifiedCatalog(catalog);
  const descriptor = snapshot.packages[packageId];
  if (!isPlainObject(descriptor)) return null;
  const version = descriptor.channels?.stable;
  if (typeof version !== "string" || !isPlainObject(descriptor.versions?.[version])) return null;
  return deepFreeze({ channel: "stable", version, release: cloneValue(descriptor.versions[version]) });
}

export function getVerifiedPackageView(catalog, packageId) {
  const snapshot = requireVerifiedCatalog(catalog);
  const descriptor = snapshot.packages[packageId];
  if (!isPlainObject(descriptor)) return null;
  return deepFreeze({
    id: packageId,
    publisher: descriptor.publisher,
    source: descriptor.source ? cloneValue(descriptor.source) : null,
    descriptor: cloneValue(descriptor),
    defaultRelease: resolveVerifiedDefaultRelease(catalog, packageId),
    stableRelease: resolveVerifiedStableRelease(catalog, packageId),
    marketplaceProfile: projectVerifiedMarketplaceProfile(catalog, packageId),
    verified: true,
    revision: snapshot.revision,
    sequence: snapshot.sequence,
  });
}

export function enumerateVerifiedPackages(catalog, { marketplaceOnly = false } = {}) {
  const snapshot = requireVerifiedCatalog(catalog);
  const views = Object.keys(snapshot.packages)
    .sort()
    .map((packageId) => getVerifiedPackageView(catalog, packageId));
  return deepFreeze(marketplaceOnly ? views.filter((view) => view.marketplaceProfile !== null) : views);
}

export function searchVerifiedPackages(catalog, query, { marketplaceOnly = false } = {}) {
  const normalized = String(query ?? "").trim().toLocaleLowerCase("en-US");
  const packages = enumerateVerifiedPackages(catalog, { marketplaceOnly });
  if (!normalized) return packages;
  return deepFreeze(packages.filter((view) => {
    const profile = view.marketplaceProfile;
    const haystack = [
      view.id,
      view.publisher,
      profile?.details,
      profile?.features,
      profile?.changelog,
      profile?.dependencies,
      profile?.extension_pack,
    ].filter((value) => typeof value === "string").join("\n").toLocaleLowerCase("en-US");
    return haystack.includes(normalized);
  }));
}
