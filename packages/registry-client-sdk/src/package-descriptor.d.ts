export declare const PACKAGE_DESCRIPTOR_SCHEMA_VERSION: "2.0.0";
export declare const PACKAGE_DESCRIPTOR_DELIVERY_TYPE: "github-release-asset";
export declare const PACKAGE_DESCRIPTOR_ACCESS_CONTRACT: "registry-access-v1";
export declare const PACKAGE_DESCRIPTOR_ARTIFACT_REPOSITORY: "Simple-Connection/sctool-artifacts";

export type RegistrySourceVisibility = "public" | "private" | "undisclosed";

export interface RegistryPackageSource {
  readonly visibility: RegistrySourceVisibility;
  readonly repository?: string;
}

export interface RegistryArtifactTarget {
  readonly platform: string;
  readonly arch: string;
}

export interface RegistryArtifactContent {
  readonly filename: string;
  readonly sha256: string;
  readonly size: number;
}

export interface RegistryArtifactDeliveryAccess {
  readonly contract: "registry-access-v1";
}

export interface RegistryGitHubReleaseAssetLocator {
  readonly repository: "Simple-Connection/sctool-artifacts";
  readonly assetId: number;
}

export interface RegistryArtifactDelivery {
  readonly type: "github-release-asset";
  readonly access: RegistryArtifactDeliveryAccess;
  readonly locator: RegistryGitHubReleaseAssetLocator;
}

export interface RegistryArtifactContract {
  readonly sctoolSpecVersion: string;
}

export interface RegistryArtifactSignature {
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly scope: "sctool-submission-v1";
  readonly submissionId: string;
  readonly submittedAt: string;
  readonly sdkVersion: string;
  readonly value: string;
}

export interface RegistryPackageArtifact {
  readonly target: RegistryArtifactTarget;
  readonly content: RegistryArtifactContent;
  readonly delivery: RegistryArtifactDelivery;
  readonly publishedAt: string;
  readonly contract: RegistryArtifactContract;
  readonly signature: RegistryArtifactSignature;
}

export interface RegistryPackageVersion {
  readonly artifacts: Readonly<Record<string, RegistryPackageArtifact>>;
}

export interface RegistryPackageDescriptor {
  readonly $schema?: string;
  readonly schemaVersion: "2.0.0";
  readonly id: string;
  readonly publisher: string;
  readonly source?: RegistryPackageSource;
  readonly defaultChannel: string;
  readonly channels: Readonly<Record<string, string>>;
  readonly versions: Readonly<Record<string, RegistryPackageVersion>>;
}

export interface RegistryPackageDescriptorIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface RegistryPackageDescriptorValidationSuccess {
  readonly ok: true;
  readonly descriptor: RegistryPackageDescriptor;
}

export interface RegistryPackageDescriptorValidationFailure {
  readonly ok: false;
  readonly issues: readonly RegistryPackageDescriptorIssue[];
}

export type RegistryPackageDescriptorValidationResult =
  | RegistryPackageDescriptorValidationSuccess
  | RegistryPackageDescriptorValidationFailure;

export interface RegistryPackageDescriptorValidationOptions {
  readonly expectedPackageId?: string;
}

export declare class RegistryPackageDescriptorError extends Error {
  readonly code: "registry-package-descriptor-invalid";
  readonly issues: readonly RegistryPackageDescriptorIssue[];
  constructor(issues: readonly RegistryPackageDescriptorIssue[]);
}

export declare function validatePackageDescriptor(
  input: unknown,
  options?: RegistryPackageDescriptorValidationOptions,
): RegistryPackageDescriptorValidationResult;

export declare function parsePackageDescriptor(
  input: unknown,
  options?: RegistryPackageDescriptorValidationOptions,
): RegistryPackageDescriptor;
