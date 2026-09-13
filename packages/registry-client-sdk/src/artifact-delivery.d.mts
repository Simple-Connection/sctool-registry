import type { RegistryGitHubIdentity } from "./registry-access.mjs";

export interface RegistryPublicFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
  json(): Promise<unknown>;
}

export type RegistryPublicFetch = (
  url: string,
  init?: Readonly<Record<string, unknown>>,
) => Promise<RegistryPublicFetchResponse>;

export type RegistryArtifactDeliverySource = "cache" | "origin";
export type RegistryArtifactDeliverySourceRequest = "preferred" | RegistryArtifactDeliverySource;

export interface RegistryExactReleaseAssetLocator {
  readonly repository?: string;
  readonly releaseId?: number;
  readonly assetId?: number;
}

export interface ResolvedRegistryTargetDelivery {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey?: string | null;
  readonly deliveryPlan?: {
    readonly isCurrentDefaultVersion?: boolean;
    readonly preferredSource?: RegistryArtifactDeliverySource;
    readonly fallbackSource?: "origin" | null;
  };
  readonly delivery: {
    readonly type: string;
    readonly access?: { readonly contract?: string };
    readonly origin?: RegistryExactReleaseAssetLocator;
    readonly cache?: RegistryExactReleaseAssetLocator;
  };
}

export interface ResolvedGitHubReleaseAsset {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey: string | null;
  readonly source: RegistryArtifactDeliverySource;
  readonly repository: string;
  readonly releaseId: number;
  readonly assetId: number;
  readonly backendTag: string | null;
  readonly backendAssetName: string | null;
  readonly backendAssetSize: number | null;
  readonly assetApiUrl: string;
  readonly identity: RegistryGitHubIdentity | null;
}

export interface RegistryArtifactReadableStream extends AsyncIterable<Uint8Array> {
  pipe(destination: unknown): unknown;
  destroy(error?: Error): void;
}

export interface ResolveGitHubReleaseAssetOptions {
  readonly source?: RegistryArtifactDeliverySourceRequest;
  readonly fetchImpl?: RegistryPublicFetch;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface OpenGitHubReleaseAssetStreamOptions extends ResolveGitHubReleaseAssetOptions {}

export interface OpenedGitHubReleaseAssetStream {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey: string | null;
  readonly source: RegistryArtifactDeliverySource;
  readonly repository: string;
  readonly releaseId: number;
  readonly assetId: number;
  readonly backendTag: string | null;
  readonly backendAssetName: string | null;
  readonly backendAssetSize: number | null;
  readonly identity: RegistryGitHubIdentity | null;
  readonly stream: RegistryArtifactReadableStream;
  readonly completed: Promise<Readonly<{ exitCode: 0 }>>;
  readonly abort: () => boolean;
}

export declare class RegistryArtifactDeliveryError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** @deprecated Release tags are not locator authority in package schema v3. */
export declare function deriveExpectedReleaseTag(packageId: string, version: string): string;

export declare function resolveGitHubReleaseAsset(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: ResolveGitHubReleaseAssetOptions,
): Promise<ResolvedGitHubReleaseAsset>;

export declare function openGitHubReleaseAssetStream(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: OpenGitHubReleaseAssetStreamOptions,
): Promise<OpenedGitHubReleaseAssetStream>;

export declare function resolveGitHubReleaseAssetWithGitHubCli(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: ResolveGitHubReleaseAssetOptions,
): Promise<ResolvedGitHubReleaseAsset>;

export declare function openGitHubReleaseAssetStreamWithGitHubCli(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: OpenGitHubReleaseAssetStreamOptions,
): Promise<OpenedGitHubReleaseAssetStream>;

/** @deprecated Public artifact retrieval does not use GitHub CLI subprocess streaming. */
export declare function createGitHubCliStreamCommandRunner(): null;
