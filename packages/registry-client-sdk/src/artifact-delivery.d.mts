import type {
  GitHubExecError,
  GitHubExecFile,
  RegistryCommandRunner,
  RegistryGitHubIdentity,
} from "./registry-access.mjs";

export interface ResolvedRegistryTargetDelivery {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey?: string | null;
  readonly delivery: {
    readonly type: string;
    readonly access?: { readonly contract?: string };
    readonly locator?: {
      readonly repository?: string;
      readonly assetId?: number;
    };
  };
}

export interface ResolvedGitHubReleaseAsset {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey: string | null;
  readonly repository: string;
  readonly expectedTag: string;
  readonly releaseId: number | null;
  readonly assetId: number;
  readonly backendAssetName: string | null;
  readonly backendAssetSize: number | null;
  readonly assetApiPath: string;
  readonly identity: RegistryGitHubIdentity;
}

export type RegistryBinaryCommandOutcome =
  | { readonly kind: "completed"; readonly exitCode: number; readonly stdout: Uint8Array; readonly stderr: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "timeout" }
  | { readonly kind: "transport-error" };

export interface RegistryBinaryCommandRequest {
  readonly command: "gh";
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
}

export type RegistryBinaryCommandRunner = (
  request: RegistryBinaryCommandRequest,
) => Promise<RegistryBinaryCommandOutcome>;

export interface GitHubBinaryExecFileOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly encoding: null;
  readonly windowsHide: true;
  readonly timeout: number;
  readonly maxBuffer: number;
}

export type GitHubBinaryExecFile = (
  command: string,
  args: string[],
  options: GitHubBinaryExecFileOptions,
  callback: (
    error: GitHubExecError | null,
    stdout?: Uint8Array,
    stderr?: Uint8Array,
  ) => void,
) => void;

export interface ResolveGitHubReleaseAssetOptions {
  readonly runner?: RegistryCommandRunner;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface RetrieveGitHubReleaseAssetOptions {
  readonly runner?: RegistryCommandRunner;
  readonly binaryRunner?: RegistryBinaryCommandRunner;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface ResolveGitHubReleaseAssetWithGitHubCliOptions {
  readonly execFileImpl?: GitHubExecFile;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface RetrieveGitHubReleaseAssetWithGitHubCliOptions {
  readonly execFileImpl?: GitHubExecFile & GitHubBinaryExecFile;
  readonly maxBufferBytes?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface RetrievedGitHubReleaseAsset {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey: string | null;
  readonly repository: string;
  readonly expectedTag: string;
  readonly assetId: number;
  readonly identity: RegistryGitHubIdentity;
  readonly bytes: Uint8Array;
}

export declare class RegistryArtifactDeliveryError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export declare function deriveExpectedReleaseTag(packageId: string, version: string): string;

export declare function resolveGitHubReleaseAsset(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: ResolveGitHubReleaseAssetOptions,
): Promise<ResolvedGitHubReleaseAsset>;

export declare function createGitHubCliBinaryCommandRunner(
  options?: {
    readonly execFileImpl?: GitHubBinaryExecFile;
    readonly maxBufferBytes?: number;
  },
): RegistryBinaryCommandRunner | null;

export declare function retrieveGitHubReleaseAsset(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: RetrieveGitHubReleaseAssetOptions,
): Promise<RetrievedGitHubReleaseAsset>;

export declare function resolveGitHubReleaseAssetWithGitHubCli(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: ResolveGitHubReleaseAssetWithGitHubCliOptions,
): Promise<ResolvedGitHubReleaseAsset>;

export declare function retrieveGitHubReleaseAssetWithGitHubCli(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: RetrieveGitHubReleaseAssetWithGitHubCliOptions,
): Promise<RetrievedGitHubReleaseAsset>;
