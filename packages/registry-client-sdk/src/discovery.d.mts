export declare const REGISTRY_DISCOVERY_CONTRACT: "registry-discovery-v1";
export declare const REGISTRY_ANTI_ROLLBACK_STATE_SCHEMA: "sctool-registry-anti-rollback/v1";
export declare const REGISTRY_DISCOVERY_ERROR_CODES: Readonly<{
  DISTRIBUTION_INACTIVE: "REGISTRY_DISTRIBUTION_INACTIVE";
  FETCH_FAILED: "REGISTRY_FETCH_FAILED";
  TRUST_INVALID: "REGISTRY_TRUST_INVALID";
  ROOT_KEY_UNTRUSTED: "REGISTRY_ROOT_KEY_UNTRUSTED";
  ROOT_SIGNATURE_INVALID: "REGISTRY_ROOT_SIGNATURE_INVALID";
  HEAD_INVALID: "REGISTRY_HEAD_INVALID";
  DISTRIBUTION_KEY_INVALID: "REGISTRY_DISTRIBUTION_KEY_INVALID";
  DISTRIBUTION_SIGNATURE_INVALID: "REGISTRY_DISTRIBUTION_SIGNATURE_INVALID";
  SNAPSHOT_FETCH_FAILED: "REGISTRY_SNAPSHOT_FETCH_FAILED";
  SNAPSHOT_SIZE_MISMATCH: "REGISTRY_SNAPSHOT_SIZE_MISMATCH";
  SNAPSHOT_DIGEST_MISMATCH: "REGISTRY_SNAPSHOT_DIGEST_MISMATCH";
  SNAPSHOT_INVALID: "REGISTRY_SNAPSHOT_INVALID";
  ANTI_ROLLBACK_STORE_REQUIRED: "REGISTRY_ANTI_ROLLBACK_STORE_REQUIRED";
  ANTI_ROLLBACK_STATE_CORRUPT: "REGISTRY_ANTI_ROLLBACK_STATE_CORRUPT";
  ROLLBACK_DETECTED: "REGISTRY_ROLLBACK_DETECTED";
  SEQUENCE_CONFLICT: "REGISTRY_SEQUENCE_CONFLICT";
}>;

export type RegistryDiscoveryErrorCode = (typeof REGISTRY_DISCOVERY_ERROR_CODES)[keyof typeof REGISTRY_DISCOVERY_ERROR_CODES];

export declare class RegistryDiscoveryError extends Error {
  readonly code: RegistryDiscoveryErrorCode;
  constructor(code: RegistryDiscoveryErrorCode, message: string, options?: { readonly cause?: unknown });
}

export interface RegistryMarketplaceProfileV1 {
  readonly schemaVersion: 1;
  readonly details: string;
  readonly features: string;
  readonly changelog?: string;
  readonly dependencies?: string;
  readonly extension_pack?: string;
}

export interface RegistryDistributionKey {
  readonly keyId: string;
  readonly algorithm: "ed25519";
  readonly encoding: "base64-raw-32";
  readonly publicKey: string;
  readonly status: "active" | "retired" | "revoked";
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly retiredAt?: string;
  readonly revokedAt?: string;
  readonly validNow: boolean;
}

export interface VerifiedRegistryTrust {
  readonly schemaVersion: "1.0.0";
  readonly sequence: number;
  readonly issuedAt: string;
  readonly rootKeyId: string;
  readonly distributionKeys: Readonly<Record<string, RegistryDistributionKey>>;
}

export interface RegistrySnapshotReference {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface VerifiedRegistryHead {
  readonly schemaVersion: "1.0.0";
  readonly signed: {
    readonly scope: "sctool-registry-head-v1";
    readonly sequence: number;
    readonly revision: string;
    readonly issuedAt: string;
    readonly trustSequence: number;
    readonly signingKeyId: string;
    readonly snapshot: RegistrySnapshotReference;
  };
  readonly proof: {
    readonly algorithm: "ed25519";
    readonly scope: "sctool-registry-head-v1";
    readonly keyId: string;
    readonly signature: string;
  };
}

export interface VerifiedRegistrySnapshot {
  readonly schemaVersion: "1.0.0";
  readonly sequence: number;
  readonly revision: string;
  readonly generatedAt: string;
  readonly source: {
    readonly repository: "Simple-Connection/sctool-registry";
    readonly commit: string;
  };
  readonly registrySha256: string;
  readonly packages: Readonly<Record<string, unknown>>;
  readonly publishers: Readonly<Record<string, unknown>>;
  readonly marketplaceProfiles?: Readonly<Record<string, RegistryMarketplaceProfileV1 | unknown>>;
}

export interface RegistryAntiRollbackState {
  readonly schema: "sctool-registry-anti-rollback/v1";
  readonly sequence: number;
  readonly revision: string;
}

export interface RegistryAntiRollbackStore {
  load(): Promise<RegistryAntiRollbackState | null>;
  save(state: RegistryAntiRollbackState): Promise<void>;
}

export interface RegistryFetchResponse {
  readonly status: number;
  readonly ok: boolean;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type RegistryFetch = (input: unknown) => Promise<RegistryFetchResponse>;

export interface VerifiedRegistryDiscoverySuccess {
  readonly ok: true;
  readonly state: "VERIFIED";
  readonly contract: "registry-discovery-v1";
  readonly verification: {
    readonly trustSequence: number;
    readonly sequence: number;
    readonly revision: string;
    readonly signingKeyId: string;
    readonly snapshotSha256: string;
    readonly acceptedSequence: number;
  };
  readonly snapshot: VerifiedRegistrySnapshot;
}

export interface VerifiedRegistryDiscoveryFailure {
  readonly ok: false;
  readonly state: "DISTRIBUTION_INACTIVE" | "FAIL_CLOSED";
  readonly code: RegistryDiscoveryErrorCode;
  readonly message: string;
}

export type VerifiedRegistryDiscoveryResult = VerifiedRegistryDiscoverySuccess | VerifiedRegistryDiscoveryFailure;

export interface RegistryDiscoveryOptions {
  readonly baseUrl: string;
  readonly trustedRootKeys: Readonly<Record<string, string>> | ReadonlyMap<string, string>;
  readonly antiRollbackStore: RegistryAntiRollbackStore;
  readonly fetchImpl?: RegistryFetch;
  readonly now?: Date | string;
}

export interface VerifiedRegistryReleaseView {
  readonly channel: string;
  readonly version: string;
  readonly release: unknown;
}

export interface VerifiedRegistryPackageView {
  readonly id: string;
  readonly publisher: string;
  readonly source: unknown | null;
  readonly descriptor: unknown;
  readonly defaultRelease: VerifiedRegistryReleaseView | null;
  readonly stableRelease: VerifiedRegistryReleaseView | null;
  readonly marketplaceProfile: RegistryMarketplaceProfileV1 | null;
  readonly verified: true;
  readonly revision: string;
  readonly sequence: number;
}

export declare function verifyRegistryTrustEnvelope(
  trust: unknown,
  options: { readonly trustedRootKeys: RegistryDiscoveryOptions["trustedRootKeys"]; readonly now?: Date | string },
): VerifiedRegistryTrust;

export declare function verifyRegistryHeadEnvelope(head: unknown, verifiedTrust: VerifiedRegistryTrust): VerifiedRegistryHead;
export declare function verifyRegistrySnapshotBytes(bytes: ArrayBuffer | Uint8Array, verifiedHead: VerifiedRegistryHead): VerifiedRegistrySnapshot;
export declare function createMemoryAntiRollbackStore(initialState?: RegistryAntiRollbackState | null): RegistryAntiRollbackStore;
export declare function createFileAntiRollbackStore(filePath: string): RegistryAntiRollbackStore;
export declare function acceptRegistrySequence(store: RegistryAntiRollbackStore, state: Pick<RegistryAntiRollbackState, "sequence" | "revision">): Promise<RegistryAntiRollbackState>;
export declare function discoverVerifiedRegistry(options: RegistryDiscoveryOptions): Promise<VerifiedRegistryDiscoveryResult>;
export declare function projectVerifiedMarketplaceProfile(catalog: VerifiedRegistryDiscoverySuccess, packageId: string): RegistryMarketplaceProfileV1 | null;
export declare function resolveVerifiedDefaultRelease(catalog: VerifiedRegistryDiscoverySuccess, packageId: string): VerifiedRegistryReleaseView | null;
export declare function resolveVerifiedStableRelease(catalog: VerifiedRegistryDiscoverySuccess, packageId: string): VerifiedRegistryReleaseView | null;
export declare function getVerifiedPackageView(catalog: VerifiedRegistryDiscoverySuccess, packageId: string): VerifiedRegistryPackageView | null;
export declare function enumerateVerifiedPackages(catalog: VerifiedRegistryDiscoverySuccess, options?: { readonly marketplaceOnly?: boolean }): readonly VerifiedRegistryPackageView[];
export declare function searchVerifiedPackages(catalog: VerifiedRegistryDiscoverySuccess, query: string, options?: { readonly marketplaceOnly?: boolean }): readonly VerifiedRegistryPackageView[];
