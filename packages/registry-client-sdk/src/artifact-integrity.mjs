import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { allocateArtifactStagingResource } from "./artifact-staging.mjs";

const SHA256_RE = /^[a-f0-9]{64}$/;

export class RegistryArtifactIntegrityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RegistryArtifactIntegrityError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function requireTarget(resolvedTarget) {
  if (!resolvedTarget || typeof resolvedTarget !== "object") {
    throw new RegistryArtifactIntegrityError("invalid-target", "resolved target is required");
  }
  const content = resolvedTarget.content;
  if (!content || typeof content !== "object") {
    throw new RegistryArtifactIntegrityError("invalid-content", "resolved target content metadata is required");
  }
  if (typeof content.filename !== "string" || content.filename.length === 0) {
    throw new RegistryArtifactIntegrityError("invalid-content-filename", "content.filename must be a non-empty string");
  }
  if (!Number.isSafeInteger(content.size) || content.size <= 0) {
    throw new RegistryArtifactIntegrityError("invalid-content-size", "content.size must be a positive safe integer");
  }
  if (typeof content.sha256 !== "string" || !SHA256_RE.test(content.sha256)) {
    throw new RegistryArtifactIntegrityError("invalid-content-sha256", "content.sha256 must be lowercase SHA-256 hex");
  }
  return content;
}

function requireBinding(resolvedTarget, retrieval) {
  if (!retrieval || typeof retrieval !== "object") {
    throw new RegistryArtifactIntegrityError("invalid-retrieval", "stream retrieval result is required");
  }
  const source = retrieval.source;
  if (source !== "cache" && source !== "origin") {
    throw new RegistryArtifactIntegrityError("invalid-retrieval-source", "retrieval source must be cache or origin");
  }
  const locator = resolvedTarget.delivery?.[source];
  if (!locator || typeof locator !== "object") {
    throw new RegistryArtifactIntegrityError("artifact-binding-mismatch", "retrieval source is not present in resolved target", {
      source,
    });
  }
  const checks = [
    ["packageId", resolvedTarget.packageId, retrieval.packageId],
    ["version", resolvedTarget.version, retrieval.version],
    ["targetKey", resolvedTarget.targetKey ?? null, retrieval.targetKey ?? null],
    ["repository", locator.repository, retrieval.repository],
    ["releaseId", locator.releaseId, retrieval.releaseId],
    ["assetId", locator.assetId, retrieval.assetId],
  ];
  for (const [field, expected, actual] of checks) {
    if (expected !== actual) {
      throw new RegistryArtifactIntegrityError("artifact-binding-mismatch", "retrieved artifact does not match resolved target", {
        source,
        field,
        expected,
        actual,
      });
    }
  }
  if (!retrieval.stream || typeof retrieval.stream.pipe !== "function") {
    throw new RegistryArtifactIntegrityError("invalid-retrieval-stream", "retrieval stream is required");
  }
  if (!retrieval.completed || typeof retrieval.completed.then !== "function" || typeof retrieval.abort !== "function") {
    throw new RegistryArtifactIntegrityError("invalid-retrieval-control", "retrieval completion and abort controls are required");
  }
}

function createIntegrityTransform(expectedSize) {
  const hash = createHash("sha256");
  let byteCount = 0;
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
      const nextCount = byteCount + bytes.byteLength;
      if (nextCount > expectedSize) {
        callback(new RegistryArtifactIntegrityError("artifact-size-exceeded", "retrieved artifact exceeded declared content.size", {
          expectedSize,
          observedSize: nextCount,
        }));
        return;
      }
      byteCount = nextCount;
      hash.update(bytes);
      callback(null, bytes);
    },
  });
  return {
    stream,
    result() {
      return {
        byteCount,
        sha256: hash.digest("hex"),
      };
    },
  };
}

export async function stageAndVerifyRetrievedArtifact(resolvedTarget, retrieval, {
  temporaryRoot,
} = {}) {
  const content = requireTarget(resolvedTarget);
  let resource = null;

  try {
    requireBinding(resolvedTarget, retrieval);

    if (retrieval.backendAssetName !== content.filename) {
      throw new RegistryArtifactIntegrityError("backend-filename-mismatch", "GitHub asset name does not match Registry content.filename", {
        expected: content.filename,
        actual: retrieval.backendAssetName ?? null,
      });
    }
    if (retrieval.backendAssetSize !== null && retrieval.backendAssetSize !== undefined && retrieval.backendAssetSize !== content.size) {
      throw new RegistryArtifactIntegrityError("backend-size-mismatch", "GitHub asset size does not match Registry content.size", {
        expected: content.size,
        actual: retrieval.backendAssetSize,
      });
    }

    resource = await allocateArtifactStagingResource({ temporaryRoot });
    const integrity = createIntegrityTransform(content.size);
    const destination = resource.openWriteStream();
    await pipeline(retrieval.stream, integrity.stream, destination);
    await retrieval.completed;
    resource.markStaged();

    const observed = integrity.result();
    if (observed.byteCount !== content.size) {
      throw new RegistryArtifactIntegrityError("artifact-size-mismatch", "retrieved byte length does not match Registry content.size", {
        expected: content.size,
        actual: observed.byteCount,
      });
    }
    if (observed.sha256 !== content.sha256) {
      throw new RegistryArtifactIntegrityError("artifact-sha256-mismatch", "retrieved SHA-256 does not match Registry content.sha256", {
        expected: content.sha256,
        actual: observed.sha256,
      });
    }

    await resource.markVerified();
    return Object.freeze({
      resource,
      packageId: resolvedTarget.packageId,
      version: resolvedTarget.version,
      targetKey: resolvedTarget.targetKey ?? null,
      source: retrieval.source,
      repository: retrieval.repository,
      releaseId: retrieval.releaseId,
      assetId: retrieval.assetId,
      backendTag: retrieval.backendTag ?? null,
      filename: content.filename,
      size: content.size,
      sha256: content.sha256,
    });
  } catch (error) {
    try { retrieval?.abort?.(); } catch {}
    try { await retrieval?.completed; } catch {}
    try { await resource?.dispose(); } catch {}
    throw error;
  }
}
