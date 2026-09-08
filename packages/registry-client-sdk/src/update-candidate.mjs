import {
  DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
  createGitHubCliCommandRunner,
} from "./registry-access.mjs";
import {
  createGitHubCliStreamCommandRunner,
  openGitHubReleaseAssetStream,
} from "./artifact-delivery.mjs";
import { stageAndVerifyRetrievedArtifact } from "./artifact-integrity.mjs";
import { createVerifiedArtifactLease } from "./verified-artifact.mjs";

const INSTALLATION_AUTHORITY = "AUTH_SIMPLE_CONNECTION_DESKTOP";
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const OBSERVATION_FIELDS = Object.freeze(["authority", "installedVersion", "packageId", "targetKey"]);

export class RegistryUpdateCandidateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RegistryUpdateCandidateError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function freezeCopy(value) {
  return Object.freeze({ ...value });
}

function parseSemanticVersion(value, field) {
  if (typeof value !== "string") {
    throw new RegistryUpdateCandidateError("invalid-semver", `${field} must be a package-schema semantic version`, { field });
  }
  const match = SEMVER_RE.exec(value);
  if (!match) {
    throw new RegistryUpdateCandidateError("invalid-semver", `${field} must be a package-schema semantic version`, {
      field,
      value,
    });
  }
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4] === undefined ? null : match[4].split("."),
  };
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareSemanticVersionPrecedence(left, right) {
  const a = parseSemanticVersion(left, "leftVersion");
  const b = parseSemanticVersion(right, "rightVersion");

  for (const field of ["major", "minor", "patch"]) {
    if (a[field] < b[field]) return -1;
    if (a[field] > b[field]) return 1;
  }

  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;

  const count = Math.min(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const compared = compareIdentifier(a.prerelease[index], b.prerelease[index]);
    if (compared !== 0) return compared;
  }
  return a.prerelease.length < b.prerelease.length
    ? -1
    : a.prerelease.length > b.prerelease.length
      ? 1
      : 0;
}

function requireCandidateSource(resolvedTarget) {
  if (!resolvedTarget || typeof resolvedTarget !== "object") {
    throw new RegistryUpdateCandidateError("invalid-target", "resolved target is required");
  }
  for (const field of ["packageId", "version", "targetKey", "publishedAt"]) {
    if (typeof resolvedTarget[field] !== "string" || resolvedTarget[field].length === 0) {
      throw new RegistryUpdateCandidateError("invalid-target", `${field} must be a non-empty string`, { field });
    }
  }
  parseSemanticVersion(resolvedTarget.version, "resolvedVersion");
  if (resolvedTarget.channel !== null && resolvedTarget.channel !== undefined && typeof resolvedTarget.channel !== "string") {
    throw new RegistryUpdateCandidateError("invalid-target", "channel must be a string or null");
  }
  if (!resolvedTarget.target || typeof resolvedTarget.target.platform !== "string" || typeof resolvedTarget.target.arch !== "string") {
    throw new RegistryUpdateCandidateError("invalid-target", "target platform and arch are required");
  }
  if (!resolvedTarget.content || typeof resolvedTarget.content !== "object") {
    throw new RegistryUpdateCandidateError("invalid-target", "content metadata is required");
  }
  if (!resolvedTarget.delivery || typeof resolvedTarget.delivery !== "object") {
    throw new RegistryUpdateCandidateError("invalid-target", "delivery metadata is required");
  }
  if (!resolvedTarget.contract || typeof resolvedTarget.contract.sctoolSpecVersion !== "string") {
    throw new RegistryUpdateCandidateError("invalid-target", "SCTool contract metadata is required");
  }
}

function requireInstallationObservation(resolvedTarget, observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw new RegistryUpdateCandidateError("invalid-installation-observation", "installation observation is required");
  }
  const actualFields = Object.keys(observation).sort();
  const expectedFields = [...OBSERVATION_FIELDS].sort();
  if (
    actualFields.length !== expectedFields.length
    || actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new RegistryUpdateCandidateError(
      "invalid-installation-observation",
      "installation observation fields do not match UPDATE_CANDIDATE_V1",
      { fields: actualFields },
    );
  }
  if (observation.authority !== INSTALLATION_AUTHORITY) {
    throw new RegistryUpdateCandidateError("installation-authority-mismatch", "installation observation authority is invalid", {
      authority: observation.authority ?? null,
      expectedAuthority: INSTALLATION_AUTHORITY,
    });
  }
  if (observation.packageId !== resolvedTarget.packageId) {
    throw new RegistryUpdateCandidateError("installation-binding-mismatch", "installation packageId does not match resolved target", {
      field: "packageId",
      expected: resolvedTarget.packageId,
      actual: observation.packageId ?? null,
    });
  }
  if (observation.targetKey !== resolvedTarget.targetKey) {
    throw new RegistryUpdateCandidateError("installation-binding-mismatch", "installation targetKey does not match resolved target", {
      field: "targetKey",
      expected: resolvedTarget.targetKey,
      actual: observation.targetKey ?? null,
    });
  }
  parseSemanticVersion(observation.installedVersion, "installedVersion");
}

export function evaluateUpdateCandidateEligibility(resolvedTarget, installationObservation) {
  requireCandidateSource(resolvedTarget);
  requireInstallationObservation(resolvedTarget, installationObservation);

  const comparison = compareSemanticVersionPrecedence(
    installationObservation.installedVersion,
    resolvedTarget.version,
  );

  if (comparison < 0) {
    return Object.freeze({
      packageId: resolvedTarget.packageId,
      targetKey: resolvedTarget.targetKey,
      resolvedVersion: resolvedTarget.version,
      state: "UPDATE_AVAILABLE",
      relation: "RESOLVED_NEWER",
    });
  }
  if (comparison === 0) {
    return Object.freeze({
      packageId: resolvedTarget.packageId,
      targetKey: resolvedTarget.targetKey,
      resolvedVersion: resolvedTarget.version,
      state: "CURRENT",
      relation: "EQUAL_PRECEDENCE",
    });
  }
  return Object.freeze({
    packageId: resolvedTarget.packageId,
    targetKey: resolvedTarget.targetKey,
    resolvedVersion: resolvedTarget.version,
    state: "DOWNGRADE_NOT_CANDIDATE",
    relation: "RESOLVED_OLDER",
  });
}

function buildCandidate(resolvedTarget, verifiedRecord, lease) {
  return Object.freeze({
    packageId: resolvedTarget.packageId,
    channel: resolvedTarget.channel ?? null,
    version: resolvedTarget.version,
    targetKey: resolvedTarget.targetKey,
    target: freezeCopy({
      platform: resolvedTarget.target.platform,
      arch: resolvedTarget.target.arch,
    }),
    content: freezeCopy({
      filename: resolvedTarget.content.filename,
      sha256: resolvedTarget.content.sha256,
      size: resolvedTarget.content.size,
    }),
    delivery: freezeCopy({
      type: resolvedTarget.delivery.type,
      repository: verifiedRecord.repository,
      assetId: verifiedRecord.assetId,
      expectedTag: verifiedRecord.expectedTag,
    }),
    publishedAt: resolvedTarget.publishedAt,
    contract: freezeCopy({
      sctoolSpecVersion: resolvedTarget.contract.sctoolSpecVersion,
    }),
    artifact: lease,
  });
}

async function retrieveEligibleCandidate(resolvedTarget, {
  runner,
  streamRunner,
  environment,
  artifactRepository,
  timeoutMs,
}) {
  const retrieval = await openGitHubReleaseAssetStream(resolvedTarget, {
    runner,
    streamRunner,
    environment,
    artifactRepository,
    timeoutMs,
  });
  const verifiedRecord = await stageAndVerifyRetrievedArtifact(resolvedTarget, retrieval);
  const lease = createVerifiedArtifactLease(verifiedRecord);
  try {
    return buildCandidate(resolvedTarget, verifiedRecord, lease);
  } catch (error) {
    try { await lease.dispose(); } catch {}
    throw error;
  }
}

export async function resolveUpdateCandidate(resolvedTarget, installationObservation, {
  runner,
  streamRunner,
  environment = {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const eligibility = evaluateUpdateCandidateEligibility(resolvedTarget, installationObservation);

  if (eligibility.state !== "UPDATE_AVAILABLE") {
    return Object.freeze({
      ...eligibility,
      candidate: null,
    });
  }

  if (typeof runner !== "function" || typeof streamRunner !== "function") {
    throw new RegistryUpdateCandidateError(
      "configuration-error",
      "runner and streamRunner are required only when an update candidate is eligible",
    );
  }

  const candidate = await retrieveEligibleCandidate(resolvedTarget, {
    runner,
    streamRunner,
    environment,
    artifactRepository,
    timeoutMs,
  });
  return Object.freeze({
    ...eligibility,
    candidate,
  });
}

export async function resolveUpdateCandidateWithGitHubCli(resolvedTarget, installationObservation, {
  execFileImpl,
  spawnImpl,
  environment = globalThis.process?.env ?? {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const eligibility = evaluateUpdateCandidateEligibility(resolvedTarget, installationObservation);
  if (eligibility.state !== "UPDATE_AVAILABLE") {
    return Object.freeze({
      ...eligibility,
      candidate: null,
    });
  }

  const runner = createGitHubCliCommandRunner({ execFileImpl });
  const streamRunner = createGitHubCliStreamCommandRunner({ spawnImpl });
  if (!runner || !streamRunner) {
    throw new RegistryUpdateCandidateError(
      "configuration-error",
      "execFileImpl and spawnImpl are required only when an update candidate is eligible",
    );
  }
  return resolveUpdateCandidate(resolvedTarget, installationObservation, {
    runner,
    streamRunner,
    environment,
    artifactRepository,
    timeoutMs,
  });
}
