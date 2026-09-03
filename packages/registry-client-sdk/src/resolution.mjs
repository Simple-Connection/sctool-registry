import { parsePackageDescriptor } from "./package-descriptor.mjs";

const TARGET_PART_RE = /^[a-z0-9]+$/;

function freezeResult(value) {
  return Object.freeze(value);
}

export class RegistryResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RegistryResolutionError";
    this.code = code;
    this.details = freezeResult({ ...details });
  }
}

export function deriveTargetKey(platform, arch) {
  if (typeof platform !== "string" || !TARGET_PART_RE.test(platform)) {
    throw new RegistryResolutionError("invalid-platform", "platform must match the canonical target platform pattern", { platform });
  }
  if (typeof arch !== "string" || !TARGET_PART_RE.test(arch)) {
    throw new RegistryResolutionError("invalid-arch", "arch must match the canonical target architecture pattern", { arch });
  }
  return `${platform}-${arch}`;
}

export function resolvePackageVersion(input, { channel, version } = {}) {
  const descriptor = parsePackageDescriptor(input);
  if (channel !== undefined && version !== undefined) {
    throw new RegistryResolutionError("ambiguous-version-selector", "channel and version cannot be supplied together");
  }

  if (version !== undefined) {
    if (typeof version !== "string" || version.length === 0) {
      throw new RegistryResolutionError("invalid-version-selector", "version must be a non-empty string", { version });
    }
    const versionEntry = descriptor.versions[version];
    if (!versionEntry) throw new RegistryResolutionError("version-not-found", `version ${version} does not exist`, { version });
    return freezeResult({ packageId: descriptor.id, channel: null, version, versionEntry });
  }

  const selectedChannel = channel === undefined ? descriptor.defaultChannel : channel;
  if (typeof selectedChannel !== "string" || selectedChannel.length === 0) {
    throw new RegistryResolutionError("invalid-channel-selector", "channel must be a non-empty string", { channel: selectedChannel });
  }
  const selectedVersion = descriptor.channels[selectedChannel];
  if (!selectedVersion) {
    throw new RegistryResolutionError("channel-not-found", `channel ${selectedChannel} does not exist`, { channel: selectedChannel });
  }
  const versionEntry = descriptor.versions[selectedVersion];
  if (!versionEntry) {
    throw new RegistryResolutionError("version-not-found", `channel ${selectedChannel} points to missing version ${selectedVersion}`, {
      channel: selectedChannel,
      version: selectedVersion,
    });
  }
  return freezeResult({ packageId: descriptor.id, channel: selectedChannel, version: selectedVersion, versionEntry });
}

export function resolvePackageTarget(input, { channel, version, platform, arch } = {}) {
  const targetKey = deriveTargetKey(platform, arch);
  const resolvedVersion = resolvePackageVersion(input, { channel, version });
  const artifact = resolvedVersion.versionEntry.artifacts[targetKey];
  if (!artifact) {
    throw new RegistryResolutionError("target-not-found", `target ${targetKey} does not exist for version ${resolvedVersion.version}`, {
      version: resolvedVersion.version,
      targetKey,
    });
  }
  const canonicalTargetKey = `${artifact.target.platform}-${artifact.target.arch}`;
  if (canonicalTargetKey !== targetKey) {
    throw new RegistryResolutionError("target-identity-mismatch", `resolved artifact target ${canonicalTargetKey} does not match requested target ${targetKey}`, {
      targetKey,
      canonicalTargetKey,
    });
  }
  return freezeResult({
    packageId: resolvedVersion.packageId,
    channel: resolvedVersion.channel,
    version: resolvedVersion.version,
    targetKey,
    target: artifact.target,
    content: artifact.content,
    delivery: artifact.delivery,
    publishedAt: artifact.publishedAt,
    contract: artifact.contract,
    signature: artifact.signature,
  });
}
