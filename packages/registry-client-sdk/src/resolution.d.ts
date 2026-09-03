import type {
  RegistryArtifactContent,
  RegistryArtifactContract,
  RegistryArtifactDelivery,
  RegistryArtifactSignature,
  RegistryArtifactTarget,
  RegistryPackageDescriptor,
  RegistryPackageVersion,
} from "./package-descriptor.mjs";

export interface RegistryResolutionDetails {
  readonly [key: string]: unknown;
}

export declare class RegistryResolutionError extends Error {
  readonly code: string;
  readonly details: RegistryResolutionDetails;
  constructor(code: string, message: string, details?: RegistryResolutionDetails);
}

export interface RegistryPackageVersionSelector {
  readonly channel?: string;
  readonly version?: string;
}

export interface ResolvedRegistryPackageVersion {
  readonly packageId: string;
  readonly channel: string | null;
  readonly version: string;
  readonly versionEntry: RegistryPackageVersion;
}

export interface RegistryPackageTargetSelector extends RegistryPackageVersionSelector {
  readonly platform: string;
  readonly arch: string;
}

export interface ResolvedRegistryPackageTarget {
  readonly packageId: string;
  readonly channel: string | null;
  readonly version: string;
  readonly targetKey: string;
  readonly target: RegistryArtifactTarget;
  readonly content: RegistryArtifactContent;
  readonly delivery: RegistryArtifactDelivery;
  readonly publishedAt: string;
  readonly contract: RegistryArtifactContract;
  readonly signature: RegistryArtifactSignature;
}

export declare function deriveTargetKey(platform: string, arch: string): string;

export declare function resolvePackageVersion(
  input: RegistryPackageDescriptor | unknown,
  selector?: RegistryPackageVersionSelector,
): ResolvedRegistryPackageVersion;

export declare function resolvePackageTarget(
  input: RegistryPackageDescriptor | unknown,
  selector: RegistryPackageTargetSelector,
): ResolvedRegistryPackageTarget;
