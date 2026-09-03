export const PACKAGE_DESCRIPTOR_SCHEMA_VERSION = "2.0.0";
export const PACKAGE_DESCRIPTOR_DELIVERY_TYPE = "github-release-asset";
export const PACKAGE_DESCRIPTOR_ACCESS_CONTRACT = "registry-access-v1";
export const PACKAGE_DESCRIPTOR_ARTIFACT_REPOSITORY = "Simple-Connection/sctool-artifacts";

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACKAGE_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PUBLISHER_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const CHANNEL_RE = /^[a-z][a-z0-9-]{0,31}$/;
const TARGET_PART_RE = /^[a-z0-9]+$/;
const TARGET_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const REPOSITORY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const KEY_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i;

const ROOT_KEYS = new Set(["$schema", "schemaVersion", "id", "publisher", "source", "defaultChannel", "channels", "versions"]);
const SOURCE_KEYS = new Set(["visibility", "repository"]);
const VERSION_ENTRY_KEYS = new Set(["artifacts"]);
const ARTIFACT_KEYS = new Set(["target", "content", "delivery", "publishedAt", "contract", "signature"]);
const TARGET_KEYS = new Set(["platform", "arch"]);
const CONTENT_KEYS = new Set(["filename", "sha256", "size"]);
const DELIVERY_KEYS = new Set(["type", "access", "locator"]);
const ACCESS_KEYS = new Set(["contract"]);
const LOCATOR_KEYS = new Set(["repository", "assetId"]);
const CONTRACT_KEYS = new Set(["sctoolSpecVersion"]);
const SIGNATURE_KEYS = new Set(["algorithm", "keyId", "scope", "submissionId", "submittedAt", "sdkVersion", "value"]);

function issue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addRequired(issues, object, key, path) {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    issues.push(issue("missing-field", `${path}.${key}`, `required field ${key} is missing`));
    return false;
  }
  return true;
}

function addUnknownKeys(issues, object, allowed, path) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `field ${key} is not allowed`));
    }
  }
}

function requireString(issues, value, path, { minLength = 0, maxLength = Infinity, pattern = null } = {}) {
  if (typeof value !== "string") {
    issues.push(issue("invalid-type", path, "expected string"));
    return false;
  }
  if (value.length < minLength || value.length > maxLength) {
    issues.push(issue("invalid-value", path, `string length must be between ${minLength} and ${maxLength}`));
    return false;
  }
  if (pattern && !pattern.test(value)) {
    issues.push(issue("invalid-value", path, "string does not match the canonical contract pattern"));
    return false;
  }
  return true;
}

function requireSafePositiveInteger(issues, value, path) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SAFE_INTEGER) {
    issues.push(issue("invalid-value", path, `expected positive JavaScript-safe integer <= ${MAX_SAFE_INTEGER}`));
    return false;
  }
  return true;
}

function isValidUri(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return typeof parsed.protocol === "string" && parsed.protocol.length > 1;
  } catch {
    return false;
  }
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidDateTime(value) {
  if (typeof value !== "string") return false;
  const match = DATE_TIME_RE.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const monthDays = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > monthDays[month - 1]) return false;
  if (zone.toUpperCase() !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = cloneValue(child);
    return result;
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

function validateSource(source, issues, path) {
  if (!isPlainObject(source)) {
    issues.push(issue("invalid-type", path, "expected object"));
    return;
  }
  addUnknownKeys(issues, source, SOURCE_KEYS, path);
  if (addRequired(issues, source, "visibility", path)) {
    if (!new Set(["public", "private", "undisclosed"]).has(source.visibility)) {
      issues.push(issue("invalid-value", `${path}.visibility`, "visibility must be public, private, or undisclosed"));
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, "repository") && !isValidUri(source.repository)) {
    issues.push(issue("invalid-value", `${path}.repository`, "repository must be a valid URI"));
  }
}

function validateTarget(target, issues, path) {
  if (!isPlainObject(target)) {
    issues.push(issue("invalid-type", path, "expected object"));
    return;
  }
  addUnknownKeys(issues, target, TARGET_KEYS, path);
  if (addRequired(issues, target, "platform", path)) requireString(issues, target.platform, `${path}.platform`, { pattern: TARGET_PART_RE });
  if (addRequired(issues, target, "arch", path)) requireString(issues, target.arch, `${path}.arch`, { pattern: TARGET_PART_RE });
}

function validateContent(content, issues, path) {
  if (!isPlainObject(content)) {
    issues.push(issue("invalid-type", path, "expected object"));
    return;
  }
  addUnknownKeys(issues, content, CONTENT_KEYS, path);
  if (addRequired(issues, content, "filename", path)) requireString(issues, content.filename, `${path}.filename`, { minLength: 1, maxLength: 255 });
  if (addRequired(issues, content, "sha256", path)) requireString(issues, content.sha256, `${path}.sha256`, { pattern: SHA256_RE });
  if (addRequired(issues, content, "size", path)) requireSafePositiveInteger(issues, content.size, `${path}.size`);
}

function validateDelivery(delivery, issues, path) {
  if (!isPlainObject(delivery)) {
    issues.push(issue("invalid-type", path, "expected object"));
    return;
  }
  addUnknownKeys(issues, delivery, DELIVERY_KEYS, path);
  if (addRequired(issues, delivery, "type", path) && delivery.type !== PACKAGE_DESCRIPTOR_DELIVERY_TYPE) {
    issues.push(issue("unsupported-delivery-type", `${path}.type`, `delivery.type must be ${PACKAGE_DESCRIPTOR_DELIVERY_TYPE}`));
  }
  if (addRequired(issues, delivery, "access", path)) {
    const accessPath = `${path}.access`;
    if (!isPlainObject(delivery.access)) {
      issues.push(issue("invalid-type", accessPath, "expected object"));
    } else {
      addUnknownKeys(issues, delivery.access, ACCESS_KEYS, accessPath);
      if (addRequired(issues, delivery.access, "contract", accessPath) && delivery.access.contract !== PACKAGE_DESCRIPTOR_ACCESS_CONTRACT) {
        issues.push(issue("invalid-access-contract", `${accessPath}.contract`, `access contract must be ${PACKAGE_DESCRIPTOR_ACCESS_CONTRACT}`));
      }
    }
  }
  if (addRequired(issues, delivery, "locator", path)) {
    const locatorPath = `${path}.locator`;
    if (!isPlainObject(delivery.locator)) {
      issues.push(issue("invalid-type", locatorPath, "expected object"));
    } else {
      addUnknownKeys(issues, delivery.locator, LOCATOR_KEYS, locatorPath);
      if (addRequired(issues, delivery.locator, "repository", locatorPath)) {
        requireString(issues, delivery.locator.repository, `${locatorPath}.repository`, { pattern: REPOSITORY_RE });
        if (delivery.locator.repository !== PACKAGE_DESCRIPTOR_ARTIFACT_REPOSITORY) {
          issues.push(issue("artifact-repository-mismatch", `${locatorPath}.repository`, `repository must be ${PACKAGE_DESCRIPTOR_ARTIFACT_REPOSITORY}`));
        }
      }
      if (addRequired(issues, delivery.locator, "assetId", locatorPath)) requireSafePositiveInteger(issues, delivery.locator.assetId, `${locatorPath}.assetId`);
    }
  }
}

function validateContract(contract, issues, path) {
  if (!isPlainObject(contract)) {
    issues.push(issue("invalid-type", path, "expected object"));
    return;
  }
  addUnknownKeys(issues, contract, CONTRACT_KEYS, path);
  if (addRequired(issues, contract, "sctoolSpecVersion", path)) requireString(issues, contract.sctoolSpecVersion, `${path}.sctoolSpecVersion`, { pattern: SEMVER_RE });
}

function validateSignature(signature, issues, path) {
  if (!isPlainObject(signature)) {
    issues.push(issue("invalid-type", path, "expected object"));
    return;
  }
  addUnknownKeys(issues, signature, SIGNATURE_KEYS, path);
  const required = ["algorithm", "keyId", "scope", "submissionId", "submittedAt", "sdkVersion", "value"];
  for (const key of required) addRequired(issues, signature, key, path);
  if (Object.prototype.hasOwnProperty.call(signature, "algorithm") && signature.algorithm !== "ed25519") {
    issues.push(issue("invalid-value", `${path}.algorithm`, "algorithm must be ed25519"));
  }
  if (Object.prototype.hasOwnProperty.call(signature, "keyId")) requireString(issues, signature.keyId, `${path}.keyId`, { pattern: KEY_ID_RE });
  if (Object.prototype.hasOwnProperty.call(signature, "scope") && signature.scope !== "sctool-submission-v1") {
    issues.push(issue("invalid-value", `${path}.scope`, "scope must be sctool-submission-v1"));
  }
  if (Object.prototype.hasOwnProperty.call(signature, "submissionId")) requireString(issues, signature.submissionId, `${path}.submissionId`, { minLength: 16, maxLength: 128 });
  if (Object.prototype.hasOwnProperty.call(signature, "submittedAt") && !isValidDateTime(signature.submittedAt)) {
    issues.push(issue("invalid-value", `${path}.submittedAt`, "submittedAt must be an RFC 3339 date-time"));
  }
  if (Object.prototype.hasOwnProperty.call(signature, "sdkVersion")) requireString(issues, signature.sdkVersion, `${path}.sdkVersion`, { pattern: SEMVER_RE });
  if (Object.prototype.hasOwnProperty.call(signature, "value")) requireString(issues, signature.value, `${path}.value`, { pattern: BASE64_RE });
}

function validateArtifact(artifact, issues, path, targetKey) {
  if (!isPlainObject(artifact)) {
    issues.push(issue("invalid-type", path, "expected object"));
    return;
  }
  addUnknownKeys(issues, artifact, ARTIFACT_KEYS, path);
  for (const key of ARTIFACT_KEYS) addRequired(issues, artifact, key, path);
  if (Object.prototype.hasOwnProperty.call(artifact, "target")) {
    validateTarget(artifact.target, issues, `${path}.target`);
    if (isPlainObject(artifact.target) && typeof artifact.target.platform === "string" && typeof artifact.target.arch === "string") {
      const expectedKey = `${artifact.target.platform}-${artifact.target.arch}`;
      if (targetKey !== expectedKey) {
        issues.push(issue("target-key-mismatch", `${path}.target`, `artifact map key ${targetKey} must equal ${expectedKey}`));
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(artifact, "content")) validateContent(artifact.content, issues, `${path}.content`);
  if (Object.prototype.hasOwnProperty.call(artifact, "delivery")) validateDelivery(artifact.delivery, issues, `${path}.delivery`);
  if (Object.prototype.hasOwnProperty.call(artifact, "publishedAt") && !isValidDateTime(artifact.publishedAt)) {
    issues.push(issue("invalid-value", `${path}.publishedAt`, "publishedAt must be an RFC 3339 date-time"));
  }
  if (Object.prototype.hasOwnProperty.call(artifact, "contract")) validateContract(artifact.contract, issues, `${path}.contract`);
  if (Object.prototype.hasOwnProperty.call(artifact, "signature")) validateSignature(artifact.signature, issues, `${path}.signature`);
}

function collectPackageDescriptorIssues(input, expectedPackageId) {
  const issues = [];
  if (!isPlainObject(input)) {
    return [issue("invalid-type", "$", "package descriptor must be an object")];
  }

  addUnknownKeys(issues, input, ROOT_KEYS, "$");
  for (const key of ["schemaVersion", "id", "publisher", "defaultChannel", "channels", "versions"]) addRequired(issues, input, key, "$");

  if (Object.prototype.hasOwnProperty.call(input, "$schema")) requireString(issues, input.$schema, "$.$schema");
  if (Object.prototype.hasOwnProperty.call(input, "schemaVersion") && input.schemaVersion !== PACKAGE_DESCRIPTOR_SCHEMA_VERSION) {
    issues.push(issue("unsupported-schema-version", "$.schemaVersion", `schemaVersion must be ${PACKAGE_DESCRIPTOR_SCHEMA_VERSION}`));
  }
  if (Object.prototype.hasOwnProperty.call(input, "id")) {
    requireString(issues, input.id, "$.id", { pattern: PACKAGE_ID_RE });
    if (expectedPackageId !== undefined && input.id !== expectedPackageId) {
      issues.push(issue("package-id-mismatch", "$.id", `descriptor id ${String(input.id)} does not match expected package id ${expectedPackageId}`));
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "publisher")) requireString(issues, input.publisher, "$.publisher", { pattern: PUBLISHER_ID_RE });
  if (Object.prototype.hasOwnProperty.call(input, "source")) validateSource(input.source, issues, "$.source");
  if (Object.prototype.hasOwnProperty.call(input, "defaultChannel")) requireString(issues, input.defaultChannel, "$.defaultChannel", { pattern: CHANNEL_RE });

  const channels = input.channels;
  if (Object.prototype.hasOwnProperty.call(input, "channels")) {
    if (!isPlainObject(channels)) {
      issues.push(issue("invalid-type", "$.channels", "channels must be an object"));
    } else {
      const entries = Object.entries(channels);
      if (entries.length < 1) issues.push(issue("invalid-value", "$.channels", "channels must contain at least one entry"));
      for (const [channel, version] of entries) {
        if (!CHANNEL_RE.test(channel)) issues.push(issue("invalid-value", `$.channels.${channel}`, "channel name does not match the canonical pattern"));
        requireString(issues, version, `$.channels.${channel}`, { pattern: SEMVER_RE });
      }
    }
  }

  const versions = input.versions;
  if (Object.prototype.hasOwnProperty.call(input, "versions")) {
    if (!isPlainObject(versions)) {
      issues.push(issue("invalid-type", "$.versions", "versions must be an object"));
    } else {
      const versionEntries = Object.entries(versions);
      if (versionEntries.length < 1) issues.push(issue("invalid-value", "$.versions", "versions must contain at least one entry"));
      for (const [version, versionEntry] of versionEntries) {
        const versionPath = `$.versions.${version}`;
        if (!SEMVER_RE.test(version)) issues.push(issue("invalid-value", versionPath, "version key must be semantic version"));
        if (!isPlainObject(versionEntry)) {
          issues.push(issue("invalid-type", versionPath, "version entry must be an object"));
          continue;
        }
        addUnknownKeys(issues, versionEntry, VERSION_ENTRY_KEYS, versionPath);
        if (!addRequired(issues, versionEntry, "artifacts", versionPath)) continue;
        const artifacts = versionEntry.artifacts;
        if (!isPlainObject(artifacts)) {
          issues.push(issue("invalid-type", `${versionPath}.artifacts`, "artifacts must be an object"));
          continue;
        }
        const artifactEntries = Object.entries(artifacts);
        if (artifactEntries.length < 1) issues.push(issue("invalid-value", `${versionPath}.artifacts`, "artifacts must contain at least one target"));
        for (const [targetKey, artifact] of artifactEntries) {
          const artifactPath = `${versionPath}.artifacts.${targetKey}`;
          if (!TARGET_KEY_RE.test(targetKey)) issues.push(issue("invalid-value", artifactPath, "artifact target key does not match the canonical pattern"));
          validateArtifact(artifact, issues, artifactPath, targetKey);
        }
      }
    }
  }

  if (isPlainObject(channels) && typeof input.defaultChannel === "string" && !Object.prototype.hasOwnProperty.call(channels, input.defaultChannel)) {
    issues.push(issue("default-channel-missing", "$.defaultChannel", `default channel ${input.defaultChannel} does not exist in channels`));
  }
  if (isPlainObject(channels) && isPlainObject(versions)) {
    for (const [channel, version] of Object.entries(channels)) {
      if (typeof version === "string" && !Object.prototype.hasOwnProperty.call(versions, version)) {
        issues.push(issue("channel-version-missing", `$.channels.${channel}`, `channel ${channel} points to missing version ${version}`));
      }
    }
  }

  return issues;
}

export class RegistryPackageDescriptorError extends Error {
  constructor(issues) {
    const normalized = Array.isArray(issues) ? issues : [];
    const summary = normalized[0]?.message ?? "invalid Registry package descriptor";
    super(summary);
    this.name = "RegistryPackageDescriptorError";
    this.code = "registry-package-descriptor-invalid";
    this.issues = Object.freeze([...normalized]);
  }
}

export function validatePackageDescriptor(input, { expectedPackageId } = {}) {
  if (expectedPackageId !== undefined && (typeof expectedPackageId !== "string" || !PACKAGE_ID_RE.test(expectedPackageId))) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([issue("invalid-expected-package-id", "$.id", "expectedPackageId must be a canonical package id")]),
    });
  }
  const issues = collectPackageDescriptorIssues(input, expectedPackageId);
  if (issues.length > 0) return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  const descriptor = deepFreeze(cloneValue(input));
  return Object.freeze({ ok: true, descriptor });
}

export function parsePackageDescriptor(input, options = {}) {
  const result = validatePackageDescriptor(input, options);
  if (!result.ok) throw new RegistryPackageDescriptorError(result.issues);
  return result.descriptor;
}
